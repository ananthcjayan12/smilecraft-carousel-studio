use axum::{
    body::Body,
    extract::{Path as AxPath, State},
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use chrono::Utc;
use include_dir::{include_dir, Dir};
use keyring::Entry;
use reqwest::multipart;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tempfile::tempdir;
use tower_http::limit::RequestBodyLimitLayer;
use uuid::Uuid;

static WEB: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../web");
const KEYRING_SERVICE: &str = "com.carouselstudio.desktop";

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
    root: Arc<PathBuf>,
    http: reqwest::Client,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad(message: impl Into<String>) -> Self { Self { status: StatusCode::BAD_REQUEST, message: message.into() } }
    fn not_found(message: impl Into<String>) -> Self { Self { status: StatusCode::NOT_FOUND, message: message.into() } }
    fn conflict(message: impl Into<String>) -> Self { Self { status: StatusCode::CONFLICT, message: message.into() } }
    fn internal(message: impl Into<String>) -> Self { Self { status: StatusCode::INTERNAL_SERVER_ERROR, message: message.into() } }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn now() -> String { Utc::now().to_rfc3339() }
fn id() -> String { Uuid::new_v4().to_string() }
fn json_text(v: &Value) -> String { serde_json::to_string(v).unwrap_or_else(|_| "{}".into()) }
fn parse_json(s: String) -> Value { serde_json::from_str(&s).unwrap_or_else(|_| json!({})) }

fn packs() -> Vec<Value> {
    let langs = json!([
        {"id":"english","label":"English"},
        {"id":"malayalam-english","label":"Malayalam + English"},
        {"id":"malayalam","label":"Malayalam"}
    ]);
    vec![
        json!({"id":"dental","name":"Clinic — Dental","icon":"🦷","description":"Educational and service carousels for dental practices.","version":"1.0.0","defaultLanguage":"malayalam-english","languages":langs,"defaultCta":"Book a consultation","roles":["Hook","Science","Impact","Action","CTA"],"onboardingFields":[["specialty","Specialty / focus","text"],["services","Treatments / services","textarea"],["audience","Audience","text"],["approvedFacts","Approved clinical messaging","textarea"]],"topics":[["scaling","Scaling myths","Does scaling create gaps between teeth?"],["root-canal","Root canal","What should patients know about root canal treatment?"],["kids","Children's dental care","Simple dental care tips for children"]]}),
        json!({"id":"tour","name":"Tour Operator","icon":"✈️","description":"Destination, itinerary and travel-service carousels.","version":"1.0.0","defaultLanguage":"english","languages":langs,"defaultCta":"Enquire about this trip","roles":["Destination Hook","Highlights","Itinerary","Package Details","CTA"],"onboardingFields":[["destinations","Destinations","textarea"],["tripTypes","Trip types","text"],["inclusions","Typical inclusions","textarea"],["bookingContact","Booking contact","text"]],"topics":[["weekend","Weekend escape","Plan a memorable weekend escape"],["family","Family package","A family-friendly holiday package"]]}),
        json!({"id":"salon","name":"Salon","icon":"✂️","description":"Service, transformation and care carousels for salons.","version":"1.0.0","defaultLanguage":"english","languages":langs,"defaultCta":"Book a session","roles":["Desired Look","Service","Benefits","Care Tips","CTA"],"onboardingFields":[["services","Services","textarea"],["specialties","Specialties","text"],["audience","Audience","text"],["bookingContact","Booking details","text"]],"topics":[["haircare","Hair care","Simple ways to care for freshly styled hair"],["bridal","Bridal service","A polished bridal beauty service overview"]]}),
        json!({"id":"construction","name":"Construction","icon":"🏗️","description":"Service, process and verified project-showcase carousels.","version":"1.0.0","defaultLanguage":"english","languages":langs,"defaultCta":"Request a quote","roles":["Client Need","Approach","Process","Verified Work","CTA"],"onboardingFields":[["services","Services","textarea"],["serviceArea","Service area","text"],["projectTypes","Project types","textarea"],["portfolioFacts","Verified portfolio facts","textarea"]],"topics":[["build","Build process","How a well-planned project moves from idea to handover"],["renovation","Renovation","Planning a practical home renovation"]]}),
        json!({"id":"general","name":"General Business","icon":"◼️","description":"Flexible five-slide service or product storytelling.","version":"1.0.0","defaultLanguage":"english","languages":langs,"defaultCta":"Contact us","roles":["Hook","Offering","Benefits","Details","CTA"],"onboardingFields":[["services","Services / products","textarea"],["audience","Audience","text"],["preferredAction","Preferred customer action","text"],["approvedFacts","Approved business facts","textarea"]],"topics":[["service","Service overview","Introduce one of our key services"],["faq","FAQ","Answer a common customer question"]]})
    ]
}

fn pack_by_id(pack_id: &str) -> Value {
    packs().into_iter().find(|p| p["id"] == pack_id).unwrap_or_else(|| packs().pop().unwrap())
}

fn starter_slides(pack_id: &str) -> Vec<Value> {
    let pack = pack_by_id(pack_id);
    let roles = pack["roles"].as_array().cloned().unwrap_or_default();
    roles.into_iter().enumerate().map(|(i, role)| json!({
        "id": format!("slide-{}", i + 1),
        "role": role,
        "heading": "",
        "body": "",
        "visualPrompt": "",
        "approved": false,
        "approvedAt": "",
        "copyRevision": 1,
        "artworkRevision": 0,
        "artwork": "",
        "artworkAssetId": "",
        "artworkProvider": "",
        "artworkGeneratedAt": "",
        "artworkReviewed": false,
        "artworkReviewedAt": ""
    })).collect()
}

fn init_state(root: PathBuf) -> ApiResult<AppState> {
    fs::create_dir_all(root.join("assets")).map_err(|e| ApiError::internal(e.to_string()))?;
    let conn = Connection::open(root.join("carousel.sqlite")).map_err(|e| ApiError::internal(e.to_string()))?;
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys=ON;
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS clients(
          id TEXT PRIMARY KEY, name TEXT NOT NULL, business_pack_id TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
          profile_json TEXT NOT NULL, brand_json TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects(
          id TEXT PRIMARY KEY, client_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
          archived INTEGER NOT NULL DEFAULT 0, business_pack_id TEXT NOT NULL,
          context_json TEXT NOT NULL, project_json TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id,updated_at DESC);
        CREATE TABLE IF NOT EXISTS assets(
          id TEXT PRIMARY KEY, client_id TEXT, project_id TEXT, kind TEXT NOT NULL,
          file_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
          checksum TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS templates(
          id TEXT PRIMARY KEY, client_id TEXT, name TEXT NOT NULL, business_pack_id TEXT,
          mode TEXT NOT NULL, data_json TEXT NOT NULL, checksum TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS jobs(
          id TEXT PRIMARY KEY, client_id TEXT NOT NULL, project_id TEXT NOT NULL,
          slide_index INTEGER, stage TEXT NOT NULL, provider TEXT NOT NULL, model TEXT,
          status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, finished_at TEXT
        );
        "#,
    ).map_err(|e| ApiError::internal(e.to_string()))?;

    let builtins = [
        ("dental", "Teal Editorial Pro", "/assets/design-systems/teal-editorial-pro.png"),
        ("tour", "Neutral Starter", "/assets/teal-editorial.jpg"),
        ("salon", "Neutral Starter", "/assets/friendly-clinic.jpg"),
        ("construction", "Neutral Starter", "/assets/clinical-clean.jpg"),
        ("general", "Neutral Starter", "/assets/premium-dark.jpg"),
    ];
    for (pack, name, path) in builtins {
        let tid = if pack == "dental" {
            "builtin:dental:legacy:teal-editorial-pro:1.0.0".to_string()
        } else {
            format!("builtin:{pack}:neutral:1.0.0")
        };
        let data = json!({"slides": (1..=5).map(|position| json!({"position":position,"staticPath":path})).collect::<Vec<_>>()});
        conn.execute(
            "INSERT OR IGNORE INTO templates(id,client_id,name,business_pack_id,mode,data_json,checksum,created_at) VALUES(?1,NULL,?2,?3,'slides',?4,?5,?6)",
            params![tid, name, pack, json_text(&data), format!("builtin-{pack}"), now()]
        ).map_err(|e| ApiError::internal(e.to_string()))?;
    }

    Ok(AppState {
        db: Arc::new(Mutex::new(conn)),
        root: Arc::new(root),
        http: reqwest::Client::builder().user_agent("CarouselStudio/0.1").build().map_err(|e| ApiError::internal(e.to_string()))?,
    })
}

fn client_from_parts(id:&str,name:&str,pack:&str,revision:i64,archived:i64,profile:String,brand:String,created:&str,updated:&str)->Value{
    json!({"id":id,"name":name,"businessPackId":pack,"revision":revision,"archived":archived!=0,"profile":parse_json(profile),"brand":parse_json(brand),"createdAt":created,"updatedAt":updated})
}

fn get_client(state: &AppState, client_id: &str) -> ApiResult<Value> {
    let db = state.db.lock().map_err(|_| ApiError::internal("Database lock failed"))?;
    let row:Option<(String,String,String,i64,i64,String,String,String,String)>=db.query_row(
        "SELECT id,name,business_pack_id,revision,archived,profile_json,brand_json,created_at,updated_at FROM clients WHERE id=?1",
        params![client_id],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?))
    ).optional().map_err(|e|ApiError::internal(e.to_string()))?;
    row.map(|r|client_from_parts(&r.0,&r.1,&r.2,r.3,r.4,r.5,r.6,&r.7,&r.8)).ok_or_else(||ApiError::not_found("Client not found."))
}

fn get_project(state: &AppState, client_id: &str, project_id: &str) -> ApiResult<Value> {
    let db = state.db.lock().map_err(|_| ApiError::internal("Database lock failed"))?;
    let row: Option<(String,String,i64,i64,String,String,String,String,String)> = db.query_row(
        "SELECT id,client_id,revision,archived,business_pack_id,context_json,project_json,created_at,updated_at FROM projects WHERE id=?1",
        params![project_id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?))
    ).optional().map_err(|e| ApiError::internal(e.to_string()))?;
    let Some((pid,cid,revision,archived,pack,context,project,created,updated)) = row else { return Err(ApiError::not_found("Project not found.")); };
    if cid != client_id { return Err(ApiError::not_found("Project not found.")); }
    let mut v = parse_json(project);
    let obj = v.as_object_mut().ok_or_else(|| ApiError::internal("Invalid stored project"))?;
    obj.insert("id".into(), json!(pid));
    obj.insert("clientId".into(), json!(cid));
    obj.insert("revision".into(), json!(revision));
    obj.insert("archived".into(), json!(archived != 0));
    obj.insert("businessPackId".into(), json!(pack));
    obj.insert("contextSnapshot".into(), parse_json(context));
    obj.insert("createdAt".into(), json!(created));
    obj.insert("updatedAt".into(), json!(updated));
    Ok(v)
}

async fn business_packs() -> Json<Value> { Json(json!({"packs": packs()})) }

async fn list_clients(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let db = state.db.lock().map_err(|_| ApiError::internal("Database lock failed"))?;
    let mut stmt = db.prepare("SELECT id,name,business_pack_id,revision,archived,profile_json,brand_json,created_at,updated_at FROM clients WHERE archived=0 ORDER BY updated_at DESC").map_err(|e|ApiError::internal(e.to_string()))?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?,r.get::<_,String>(8)?))).map_err(|e|ApiError::internal(e.to_string()))?;
    let clients=rows.filter_map(Result::ok).map(|r|client_from_parts(&r.0,&r.1,&r.2,r.3,r.4,r.5,r.6,&r.7,&r.8)).collect::<Vec<_>>();
    Ok(Json(json!({"clients":clients})))
}

async fn create_client(State(state): State<AppState>, Json(input): Json<Value>) -> ApiResult<Json<Value>> {
    let name = input["name"].as_str().unwrap_or("").trim();
    if name.is_empty() { return Err(ApiError::bad("Client name is required.")); }
    let pack = input["businessPackId"].as_str().unwrap_or("general");
    if !packs().iter().any(|p| p["id"] == pack) { return Err(ApiError::bad("Unknown business pack.")); }
    let client_id=id(); let ts=now();
    let profile=input.get("profile").cloned().unwrap_or_else(||json!({}));
    let mut brand=input.get("brand").cloned().unwrap_or_else(||json!({}));
    if let Some(o)=brand.as_object_mut(){o.entry("name".into()).or_insert(json!(name));}
    {
        let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
        db.execute("INSERT INTO clients VALUES(?1,?2,?3,1,0,?4,?5,?6,?6)",params![client_id,name,pack,json_text(&profile),json_text(&brand),ts]).map_err(|e|ApiError::internal(e.to_string()))?;
    }
    Ok(Json(json!({"client":get_client(&state,&client_id)?})))
}

async fn read_client(State(state): State<AppState>, AxPath(client_id): AxPath<String>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({"client":get_client(&state,&client_id)?})))
}

fn merge_json(mut base:Value, patch:Value)->Value{
    if let (Some(b),Some(p))=(base.as_object_mut(),patch.as_object()){for (k,v) in p{b.insert(k.clone(),v.clone());}}
    base
}

async fn update_client(State(state): State<AppState>, AxPath(client_id): AxPath<String>, Json(input): Json<Value>) -> ApiResult<Json<Value>> {
    let old=get_client(&state,&client_id)?;
    let expected=input["expectedRevision"].as_i64().unwrap_or(-1);
    if expected != old["revision"].as_i64().unwrap_or(0) { return Err(ApiError::conflict("Client changed since it was loaded.")); }
    let name=input["name"].as_str().unwrap_or_else(||old["name"].as_str().unwrap_or("Client")).trim();
    let profile=merge_json(old["profile"].clone(),input.get("profile").cloned().unwrap_or_else(||json!({})));
    let brand=merge_json(old["brand"].clone(),input.get("brand").cloned().unwrap_or_else(||json!({})));
    {
        let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
        db.execute("UPDATE clients SET name=?1,revision=?2,profile_json=?3,brand_json=?4,updated_at=?5 WHERE id=?6",params![name,expected+1,json_text(&profile),json_text(&brand),now(),client_id]).map_err(|e|ApiError::internal(e.to_string()))?;
    }
    Ok(Json(json!({"client":get_client(&state,&client_id)?})))
}

fn list_projects_inner(state:&AppState, client:Option<&str>)->ApiResult<Vec<Value>>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let sql=if client.is_some(){"SELECT id,client_id,revision,archived,business_pack_id,context_json,project_json,created_at,updated_at FROM projects WHERE archived=0 AND client_id=?1 ORDER BY updated_at DESC"}else{"SELECT id,client_id,revision,archived,business_pack_id,context_json,project_json,created_at,updated_at FROM projects WHERE archived=0 ORDER BY updated_at DESC"};
    let mut stmt=db.prepare(sql).map_err(|e|ApiError::internal(e.to_string()))?;
    let map=|r:&rusqlite::Row<'_>|->rusqlite::Result<Value>{
        let pid:String=r.get(0)?;let cid:String=r.get(1)?;let rev:i64=r.get(2)?;let archived:i64=r.get(3)?;let pack:String=r.get(4)?;
        let context:String=r.get(5)?;let project:String=r.get(6)?;let created:String=r.get(7)?;let updated:String=r.get(8)?;
        let mut v=parse_json(project); if let Some(o)=v.as_object_mut(){o.insert("id".into(),json!(pid));o.insert("clientId".into(),json!(cid));o.insert("revision".into(),json!(rev));o.insert("archived".into(),json!(archived!=0));o.insert("businessPackId".into(),json!(pack));o.insert("contextSnapshot".into(),parse_json(context));o.insert("createdAt".into(),json!(created));o.insert("updatedAt".into(),json!(updated));} Ok(v)
    };
    if let Some(c)=client{Ok(stmt.query_map(params![c],map).map_err(|e|ApiError::internal(e.to_string()))?.filter_map(Result::ok).collect())}
    else{Ok(stmt.query_map([],map).map_err(|e|ApiError::internal(e.to_string()))?.filter_map(Result::ok).collect())}
}

async fn list_projects(State(state):State<AppState>,AxPath(client_id):AxPath<String>)->ApiResult<Json<Value>>{
    Ok(Json(json!({"projects":list_projects_inner(&state,Some(&client_id))?})))
}

async fn all_projects(State(state):State<AppState>)->ApiResult<Json<Value>>{
    let mut ps=list_projects_inner(&state,None)?;
    for p in &mut ps{
        let cid=p["clientId"].as_str().map(str::to_string);
        if let (Some(o),Some(cid))=(p.as_object_mut(),cid){if let Ok(c)=get_client(&state,&cid){o.insert("clientName".into(),c["name"].clone());}}
    }
    Ok(Json(json!({"projects":ps})))
}

async fn create_project(State(state):State<AppState>,AxPath(client_id):AxPath<String>,Json(input):Json<Value>)->ApiResult<Json<Value>>{
    let client=get_client(&state,&client_id)?;
    let pack=client["businessPackId"].as_str().unwrap_or("general");
    let pdef=pack_by_id(pack);
    let context=json!({"businessPack":{"id":pack,"version":"1.0.0","name":pdef["name"]},"recipe":{"id":"default","roles":pdef["roles"],"slideCount":5,"aspectRatio":"4:5"},"brand":client["brand"],"business":client["profile"],"language":pdef["defaultLanguage"],"cta":{"text":pdef["defaultCta"],"finalSlideOnly":true}});
    let default_template=if pack=="dental"{"builtin:dental:legacy:teal-editorial-pro:1.0.0".to_string()}else{format!("builtin:{pack}:neutral:1.0.0")};
    let project=json!({"schemaVersion":1,"topic":input["topic"].as_str().unwrap_or(""),"notes":"","language":pdef["defaultLanguage"],"templateId":default_template,"slides":starter_slides(pack),"instagram":"","youtubeTitle":"","youtubeDescription":"","generation":{"writingProvider":"codex","writingModel":"gpt-5.6-sol","provider":"openai","model":"gpt-image-2"},"stage":0,"exportHistory":[]});
    let project_id=id();let ts=now();
    {
        let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
        db.execute("INSERT INTO projects VALUES(?1,?2,1,0,?3,?4,?5,?6,?6)",params![project_id,client_id,pack,json_text(&context),json_text(&project),ts]).map_err(|e|ApiError::internal(e.to_string()))?;
    }
    Ok(Json(json!({"project":get_project(&state,&client_id,&project_id)?})))
}

async fn read_project(State(state):State<AppState>,AxPath((client_id,project_id)):AxPath<(String,String)>)->ApiResult<Json<Value>>{
    Ok(Json(json!({"project":get_project(&state,&client_id,&project_id)?})))
}

async fn save_project(State(state):State<AppState>,AxPath((client_id,project_id)):AxPath<(String,String)>,Json(mut input):Json<Value>)->ApiResult<Json<Value>>{
    let old=get_project(&state,&client_id,&project_id)?;
    let expected=input["expectedRevision"].as_i64().unwrap_or(-1);
    if expected!=old["revision"].as_i64().unwrap_or(0){return Err(ApiError::conflict("Project changed since it was loaded."));}
    if let Some(o)=input.as_object_mut(){o.remove("expectedRevision");}
    let mut next=old.clone();
    if let (Some(n),Some(p))=(next.as_object_mut(),input.as_object()){for(k,v)in p{n.insert(k.clone(),v.clone());}}
    for k in ["id","clientId","revision","archived","businessPackId","contextSnapshot","createdAt","updatedAt"]{if let Some(o)=next.as_object_mut(){o.remove(k);}}
    {
        let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
        db.execute("UPDATE projects SET revision=?1,project_json=?2,updated_at=?3 WHERE id=?4",params![expected+1,json_text(&next),now(),project_id]).map_err(|e|ApiError::internal(e.to_string()))?;
    }
    Ok(Json(json!({"project":get_project(&state,&client_id,&project_id)?})))
}

async fn dashboard(State(state):State<AppState>)->ApiResult<Json<Value>>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let clients:i64=db.query_row("SELECT COUNT(*) FROM clients WHERE archived=0",[],|r|r.get(0)).unwrap_or(0);
    let projects:i64=db.query_row("SELECT COUNT(*) FROM projects WHERE archived=0",[],|r|r.get(0)).unwrap_or(0);
    Ok(Json(json!({"clients":clients,"projects":projects,"review":0,"running":0})))
}

fn credential(provider:&str)->Option<String>{
    Entry::new(KEYRING_SERVICE,provider).ok()?.get_password().ok().filter(|s|!s.trim().is_empty())
}
fn set_credential(provider:&str,key:&str)->ApiResult<()>{
    if !["openai","gemini","claude"].contains(&provider){return Err(ApiError::bad("Unsupported credential provider."));}
    Entry::new(KEYRING_SERVICE,provider).map_err(|e|ApiError::internal(e.to_string()))?.set_password(key.trim()).map_err(|e|ApiError::internal(e.to_string()))
}
fn remove_credential(provider:&str)->ApiResult<()>{
    if let Ok(entry)=Entry::new(KEYRING_SERVICE,provider){let _=entry.delete_credential();}
    Ok(())
}
fn cli_info(bin:&str,auth:bool)->Value{
    let version=Command::new(bin).arg("--version").output();
    let installed=version.as_ref().map(|o|o.status.success()).unwrap_or(false);
    let version_text=version.ok().map(|o|String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    let authenticated=if installed&&auth{Command::new(bin).args(["login","status"]).output().map(|o|o.status.success()).unwrap_or(false)}else{installed};
    json!({"installed":installed,"authenticated":authenticated,"version":version_text,"binary":bin})
}

async fn status()->Json<Value>{
    let codex=cli_info("codex",true);let agy=cli_info("agy",false);
    Json(json!({
        "desktop":true,"localOnly":true,
        "cli":{"codex":codex,"antigravity":agy},
        "textProviders":{
            "codex":{"available":codex["installed"].as_bool().unwrap_or(false)&&codex["authenticated"].as_bool().unwrap_or(false),"label":"Codex CLI"},
            "openai":{"available":credential("openai").is_some(),"label":"OpenAI API"},
            "gemini":{"available":credential("gemini").is_some(),"label":"Gemini API"},
            "antigravity":{"available":agy["installed"].as_bool().unwrap_or(false),"label":"Antigravity CLI"},
            "claude":{"available":credential("claude").is_some(),"label":"Claude API"}
        },
        "imageProviders":{
            "openai":{"available":credential("openai").is_some(),"label":"OpenAI API"},
            "gemini":{"available":credential("gemini").is_some(),"label":"Gemini API"},
            "codex":{"available":codex["installed"].as_bool().unwrap_or(false)&&codex["authenticated"].as_bool().unwrap_or(false),"label":"Codex CLI (experimental)"},
            "antigravity":{"available":agy["installed"].as_bool().unwrap_or(false),"label":"Antigravity CLI (experimental)"}
        }
    }))
}

async fn save_credential(AxPath(provider):AxPath<String>,Json(input):Json<Value>)->ApiResult<Json<Value>>{
    let key=input["key"].as_str().unwrap_or("").trim();
    if key.is_empty(){return Err(ApiError::bad("API key is required."));}
    set_credential(&provider,key)?;
    Ok(Json(json!({"ok":true})))
}
async fn delete_credential(AxPath(provider):AxPath<String>)->ApiResult<Json<Value>>{
    remove_credential(&provider)?;
    Ok(Json(json!({"ok":true})))
}

fn list_templates_inner(state:&AppState,client_id:Option<&str>,pack:Option<&str>)->ApiResult<Vec<Value>>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let mut stmt=db.prepare("SELECT id,client_id,name,business_pack_id,mode,data_json,checksum,created_at FROM templates ORDER BY created_at DESC").map_err(|e|ApiError::internal(e.to_string()))?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?))).map_err(|e|ApiError::internal(e.to_string()))?;
    let mut out=Vec::new();
    for row in rows.filter_map(Result::ok){
        if row.1.is_some() && row.1.as_deref()!=client_id{continue}
        if let Some(p)=pack{if row.3.as_deref().is_some_and(|x|x!=p){continue}}
        out.push(json!({"id":row.0,"clientId":row.1,"name":row.2,"businessPackId":row.3,"mode":row.4,"data":parse_json(row.5),"checksum":row.6,"createdAt":row.7}));
    }
    Ok(out)
}

async fn shared_templates(State(state):State<AppState>)->ApiResult<Json<Value>>{
    let all=list_templates_inner(&state,None,None)?;
    Ok(Json(json!({"templates":all.into_iter().filter(|t|t["clientId"].is_null()).collect::<Vec<_>>()})))
}
async fn client_templates(State(state):State<AppState>,AxPath(client_id):AxPath<String>)->ApiResult<Json<Value>>{
    let c=get_client(&state,&client_id)?;
    Ok(Json(json!({"templates":list_templates_inner(&state,Some(&client_id),c["businessPackId"].as_str())?})))
}

fn parse_data_url(v:&str)->ApiResult<(String,Vec<u8>)>{
    let (head,data)=v.split_once(',').ok_or_else(||ApiError::bad("Expected image data URL."))?;
    let mime=head.strip_prefix("data:").and_then(|x|x.strip_suffix(";base64")).ok_or_else(||ApiError::bad("Expected base64 image data URL."))?;
    if !["image/png","image/jpeg","image/webp"].contains(&mime){return Err(ApiError::bad("Only PNG, JPEG and WebP are supported."));}
    let bytes=B64.decode(data).map_err(|_|ApiError::bad("Invalid base64 image."))?;
    if bytes.len()>25_000_000{return Err(ApiError::bad("Image is too large."));}
    Ok((mime.to_string(),bytes))
}

fn store_asset(state:&AppState,client_id:Option<&str>,project_id:Option<&str>,kind:&str,name:&str,mime:&str,bytes:&[u8])->ApiResult<String>{
    let aid=id();let ext=match mime{"image/png"=>"png","image/jpeg"=>"jpg","image/webp"=>"webp",_=>"bin"};
    let dir=state.root.join("assets").join(client_id.unwrap_or("_shared"));fs::create_dir_all(&dir).map_err(|e|ApiError::internal(e.to_string()))?;
    let file=dir.join(format!("{aid}.{ext}"));fs::write(&file,bytes).map_err(|e|ApiError::internal(e.to_string()))?;
    let checksum=format!("{:x}",Sha256::digest(bytes));
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    db.execute("INSERT INTO assets VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![aid,client_id,project_id,kind,name,mime,bytes.len() as i64,checksum,file.to_string_lossy(),now()]).map_err(|e|ApiError::internal(e.to_string()))?;
    Ok(aid)
}

async fn upload_asset(State(state):State<AppState>,AxPath(client_id):AxPath<String>,Json(input):Json<Value>)->ApiResult<Json<Value>>{
    get_client(&state,&client_id)?;
    let (mime,bytes)=parse_data_url(input["image"].as_str().unwrap_or(""))?;
    let aid=store_asset(&state,Some(&client_id),input["projectId"].as_str(),input["kind"].as_str().unwrap_or("upload"),input["name"].as_str().unwrap_or("upload"),&mime,&bytes)?;
    Ok(Json(json!({"asset":{"id":aid,"clientId":client_id,"mime":mime,"size":bytes.len()}})))
}

async fn asset(State(state):State<AppState>,AxPath((client_id,asset_id)):AxPath<(String,String)>)->ApiResult<Response>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let row:Option<(Option<String>,String,String)>=db.query_row("SELECT client_id,mime,path FROM assets WHERE id=?1",params![asset_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|ApiError::internal(e.to_string()))?;
    let Some((owner,mime,path))=row else{return Err(ApiError::not_found("Asset not found."));};
    if owner.as_deref().is_some_and(|o|o!=client_id){return Err(ApiError::not_found("Asset not found."));}
    let bytes=fs::read(path).map_err(|_|ApiError::not_found("Asset file is missing."))?;
    let mut response=Response::new(Body::from(bytes));
    response.headers_mut().insert(header::CONTENT_TYPE,HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    response.headers_mut().insert(header::CACHE_CONTROL,HeaderValue::from_static("private, max-age=3600"));
    Ok(response)
}

async fn create_template(State(state):State<AppState>,AxPath(client_id):AxPath<String>,Json(input):Json<Value>)->ApiResult<Json<Value>>{
    let c=get_client(&state,&client_id)?;
    let (mime,bytes)=parse_data_url(input["image"].as_str().unwrap_or(""))?;
    let aid=store_asset(&state,Some(&client_id),None,"template-reference",input["name"].as_str().unwrap_or("Custom reference"),&mime,&bytes)?;
    let tid=format!("custom:{}",id());
    let data=json!({"slides":(1..=5).map(|position|json!({"position":position,"assetId":aid})).collect::<Vec<_>>()});
    {
        let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
        db.execute("INSERT INTO templates VALUES(?1,?2,?3,?4,'slides',?5,?6,?7)",params![tid,client_id,input["name"].as_str().unwrap_or("Custom reference"),c["businessPackId"].as_str().unwrap_or("general"),json_text(&data),format!("{:x}",Sha256::digest(bytes)),now()]).map_err(|e|ApiError::internal(e.to_string()))?;
    }
    let found=list_templates_inner(&state,Some(&client_id),c["businessPackId"].as_str())?.into_iter().find(|t|t["id"]==tid).unwrap_or(json!({}));
    Ok(Json(json!({"template":found})))
}

fn key_for(provider:&str)->ApiResult<String>{
    credential(provider).ok_or_else(||ApiError::conflict(format!("{provider} API key is not configured. Open Settings and add your own key.")))
}

fn build_text_prompt(project:&Value,task:&str,slide_index:Option<usize>,correction:&str)->String{
    let context=&project["contextSnapshot"];
    let topic=project["topic"].as_str().unwrap_or("");
    let language=project["language"].as_str().unwrap_or("english");
    let roles=context["recipe"]["roles"].clone();
    let mut prompt=format!("You are a professional social-media carousel writer. Create publication-ready content only. Do not invent prices, dates, claims, testimonials, results or contact details. Business context: {}. Topic: {:?}. Language: {}.",context,topic,language);
    if task=="draft"{prompt.push_str(&format!(" Return ONLY JSON with fields slides, instagram, youtubeTitle, youtubeDescription. slides must contain exactly five objects with heading, body and visualPrompt. Roles: {}.",roles));}
    else if let Some(i)=slide_index{prompt.push_str(&format!(" Rewrite only slide {}. Current slide: {}. Correction: {:?}. Return ONLY a JSON object with heading, body and visualPrompt.",i+1,project["slides"][i],correction));}
    prompt
}

async fn text_provider(state:&AppState,provider:&str,model:&str,prompt:&str)->ApiResult<Value>{
    match provider{
        "openai"=>{
            let key=key_for("openai")?;
            let body=json!({"model":if model.is_empty(){"gpt-5.6-sol"}else{model},"messages":[{"role":"user","content":prompt}],"response_format":{"type":"json_object"}});
            let r=state.http.post("https://api.openai.com/v1/chat/completions").bearer_auth(key).json(&body).send().await.map_err(|e|ApiError::internal(e.to_string()))?;
            let status=r.status();let v:Value=r.json().await.map_err(|e|ApiError::internal(e.to_string()))?;
            if !status.is_success(){return Err(ApiError::bad(v["error"]["message"].as_str().unwrap_or("OpenAI request failed.")));}
            serde_json::from_str(v["choices"][0]["message"]["content"].as_str().unwrap_or("{}")).map_err(|e|ApiError::bad(format!("OpenAI returned invalid JSON: {e}")))
        },
        "gemini"=>{
            let key=key_for("gemini")?;let m=if model.is_empty(){"gemini-3.1-pro"}else{model};
            let url=format!("https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent");
            let body=json!({"contents":[{"parts":[{"text":prompt}]}],"generationConfig":{"responseMimeType":"application/json"}});
            let r=state.http.post(url).header("x-goog-api-key",key).json(&body).send().await.map_err(|e|ApiError::internal(e.to_string()))?;
            let status=r.status();let v:Value=r.json().await.map_err(|e|ApiError::internal(e.to_string()))?;
            if !status.is_success(){return Err(ApiError::bad(v["error"]["message"].as_str().unwrap_or("Gemini request failed.")));}
            serde_json::from_str(v["candidates"][0]["content"]["parts"][0]["text"].as_str().unwrap_or("{}")).map_err(|e|ApiError::bad(format!("Gemini returned invalid JSON: {e}")))
        },
        "claude"=>{
            let key=key_for("claude")?;let m=if model.is_empty(){"claude-sonnet-4-6"}else{model};
            let body=json!({"model":m,"max_tokens":5000,"messages":[{"role":"user","content":prompt}]});
            let r=state.http.post("https://api.anthropic.com/v1/messages").header("x-api-key",key).header("anthropic-version","2023-06-01").json(&body).send().await.map_err(|e|ApiError::internal(e.to_string()))?;
            let status=r.status();let v:Value=r.json().await.map_err(|e|ApiError::internal(e.to_string()))?;
            if !status.is_success(){return Err(ApiError::bad(v["error"]["message"].as_str().unwrap_or("Claude request failed.")));}
            let s=v["content"][0]["text"].as_str().unwrap_or("{}");
            serde_json::from_str(s.trim()).map_err(|e|ApiError::bad(format!("Claude returned invalid JSON: {e}")))
        },
        "codex"=>{
            let dir=tempdir().map_err(|e|ApiError::internal(e.to_string()))?;
            let mut cmd=tokio::process::Command::new("codex");
            cmd.args(["exec","--skip-git-repo-check","--sandbox","read-only","--ephemeral"]);
            if !model.is_empty(){cmd.args(["--model",model]);}
            cmd.arg("--").arg(prompt).current_dir(dir.path());
            let out=cmd.output().await.map_err(|e|ApiError::bad(format!("Codex CLI could not start: {e}")))?;
            if !out.status.success(){return Err(ApiError::bad(String::from_utf8_lossy(&out.stderr).chars().take(800).collect::<String>()));}
            let s=String::from_utf8_lossy(&out.stdout);let start=s.find('{').unwrap_or(0);let end=s.rfind('}').map(|x|x+1).unwrap_or(s.len());
            serde_json::from_str(&s[start..end]).map_err(|e|ApiError::bad(format!("Codex returned invalid JSON: {e}")))
        },
        "antigravity"=>Err(ApiError::bad("Antigravity text execution is not enabled in this first desktop build. Use Gemini/OpenAI/Claude or Codex CLI.")),
        _=>Err(ApiError::bad("Unsupported writing provider."))
    }
}

fn reference_bytes(state:&AppState,client_id:&str,template_id:&str,slide:usize)->ApiResult<(String,Vec<u8>)>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let data:String=db.query_row("SELECT data_json FROM templates WHERE id=?1 AND (client_id IS NULL OR client_id=?2)",params![template_id,client_id],|r|r.get(0)).optional().map_err(|e|ApiError::internal(e.to_string()))?.ok_or_else(||ApiError::bad("Selected template is unavailable."))?;
    let v=parse_json(data);let r=&v["slides"][slide];
    if let Some(path)=r["staticPath"].as_str(){
        let key=path.trim_start_matches('/');
        let f=WEB.get_file(key).ok_or_else(||ApiError::not_found("Built-in reference is missing."))?;
        return Ok((mime_guess::from_path(key).first_or_octet_stream().to_string(),f.contents().to_vec()));
    }
    if let Some(aid)=r["assetId"].as_str(){
        let row:Option<(String,String)>=db.query_row("SELECT mime,path FROM assets WHERE id=?1 AND client_id=?2",params![aid,client_id],|rr|Ok((rr.get(0)?,rr.get(1)?))).optional().map_err(|e|ApiError::internal(e.to_string()))?;
        let (mime,path)=row.ok_or_else(||ApiError::not_found("Template asset is missing."))?;
        return Ok((mime,fs::read(path).map_err(|_|ApiError::not_found("Template file is missing."))?));
    }
    Err(ApiError::bad("Template reference is invalid."))
}

fn image_prompt(project:&Value,slide:usize)->String{
    let s=&project["slides"][slide];let brand=&project["contextSnapshot"]["brand"];
    format!("Create one final publication-ready 4:5 social carousel slide {} of 5. Follow the supplied reference image for layout and visual style. Render this approved text exactly with no extra copy. HEADING: {:?}. BODY: {:?}. BUSINESS: {:?}. PHONE only on final slide: {:?}. LOCATION only on final slide: {:?}. Visual concept: {:?}. Do not invent claims, prices, testimonials, contact details, QR codes or extra logos. Output one flat finished slide, not a mockup.",slide+1,s["heading"].as_str().unwrap_or(""),s["body"].as_str().unwrap_or(""),brand["name"].as_str().unwrap_or(""),if slide==4{brand["phone"].as_str().unwrap_or("")}else{""},if slide==4{brand["location"].as_str().unwrap_or("")}else{""},s["visualPrompt"].as_str().unwrap_or(""))
}

fn find_b64(v:&Value)->Option<String>{
    if let Some(s)=v.get("b64_json").and_then(Value::as_str){return Some(s.to_string())}
    if let Some(s)=v.get("data").and_then(Value::as_str){if s.len()>1000{return Some(s.to_string())}}
    match v{Value::Array(a)=>a.iter().find_map(find_b64),Value::Object(m)=>m.values().find_map(find_b64),_=>None}
}

async fn image_provider(state:&AppState,provider:&str,model:&str,prompt:&str,mime:&str,reference:&[u8])->ApiResult<(String,Vec<u8>)>{
    match provider{
        "openai"=>{
            let key=key_for("openai")?;let m=if model.is_empty(){"gpt-image-2"}else{model};
            let part=multipart::Part::bytes(reference.to_vec()).file_name("reference.png").mime_str(mime).map_err(|e|ApiError::internal(e.to_string()))?;
            let form=multipart::Form::new().text("model",m.to_string()).text("prompt",prompt.to_string()).text("size","1024x1280").text("quality","high").text("output_format","png").part("image[]",part);
            let r=state.http.post("https://api.openai.com/v1/images/edits").bearer_auth(key).multipart(form).send().await.map_err(|e|ApiError::internal(e.to_string()))?;
            let status=r.status();let v:Value=r.json().await.map_err(|e|ApiError::internal(e.to_string()))?;
            if !status.is_success(){return Err(ApiError::bad(v["error"]["message"].as_str().unwrap_or("OpenAI image request failed.")));}
            let b64=v["data"][0]["b64_json"].as_str().ok_or_else(||ApiError::bad("OpenAI returned no image."))?;
            Ok(("image/png".into(),B64.decode(b64).map_err(|_|ApiError::bad("OpenAI returned invalid image bytes."))?))
        },
        "gemini"=>{
            let key=key_for("gemini")?;let m=if model.is_empty(){"gemini-3.1-flash-image"}else{model};
            let body=json!({"model":m,"input":[{"type":"text","text":prompt},{"type":"image","mime_type":mime,"data":B64.encode(reference)}],"response_format":{"type":"image","mime_type":"image/png","aspect_ratio":"4:5","image_size":"2K"}});
            let r=state.http.post("https://generativelanguage.googleapis.com/v1beta/interactions").header("x-goog-api-key",key).json(&body).send().await.map_err(|e|ApiError::internal(e.to_string()))?;
            let status=r.status();let v:Value=r.json().await.map_err(|e|ApiError::internal(e.to_string()))?;
            if !status.is_success(){return Err(ApiError::bad(v["error"]["message"].as_str().unwrap_or("Gemini image request failed.")));}
            let b64=find_b64(&v).ok_or_else(||ApiError::bad("Gemini returned no image."))?;
            Ok(("image/png".into(),B64.decode(b64).map_err(|_|ApiError::bad("Gemini returned invalid image bytes."))?))
        },
        "codex"=>{
            let dir=tempdir().map_err(|e|ApiError::internal(e.to_string()))?;let ref_path=dir.path().join("reference.png");let out_path=dir.path().join("final-slide.png");
            fs::write(&ref_path,reference).map_err(|e|ApiError::internal(e.to_string()))?;
            let instruction=format!("Generate ONE finished image using high quality and save it exactly as final-slide.png in the current directory. Inspect reference.png as the visual reference. Do not merely describe it.\n\n{prompt}");
            let mut cmd=tokio::process::Command::new("codex");cmd.args(["exec","--ephemeral","--sandbox","workspace-write","--image"]).arg(&ref_path);
            if !model.is_empty(){cmd.args(["--model",model]);}
            cmd.arg("--").arg(instruction).current_dir(dir.path());
            let out=cmd.output().await.map_err(|e|ApiError::bad(format!("Codex CLI could not start: {e}")))?;
            if !out.status.success(){return Err(ApiError::bad(String::from_utf8_lossy(&out.stderr).chars().take(800).collect::<String>()));}
            Ok(("image/png".into(),fs::read(out_path).map_err(|_|ApiError::bad("Codex finished without creating final-slide.png."))?))
        },
        "antigravity"=>Err(ApiError::bad("Antigravity image execution is not enabled in this first desktop build. Use Gemini/OpenAI or Codex CLI.")),
        _=>Err(ApiError::bad("Unsupported image provider."))
    }
}

fn persist_generated_project(state:&AppState,client_id:&str,project_id:&str,old:&Value,next:&Value)->ApiResult<()>{
    let expected=old["revision"].as_i64().unwrap_or(0);let current=get_project(state,client_id,project_id)?;
    if current["revision"].as_i64().unwrap_or(-1)!=expected{return Err(ApiError::conflict("Project changed while generation was running. Retry on the current version."));}
    let mut stored=next.clone();for k in ["id","clientId","revision","archived","businessPackId","contextSnapshot","createdAt","updatedAt"]{if let Some(o)=stored.as_object_mut(){o.remove(k);}}
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    db.execute("UPDATE projects SET revision=?1,project_json=?2,updated_at=?3 WHERE id=?4",params![expected+1,json_text(&stored),now(),project_id]).map_err(|e|ApiError::internal(e.to_string()))?;
    Ok(())
}

async fn run_job(State(state):State<AppState>,AxPath((client_id,project_id)):AxPath<(String,String)>,Json(input):Json<Value>)->ApiResult<Json<Value>>{
    let project=get_project(&state,&client_id,&project_id)?;
    let stage=input["stage"].as_str().unwrap_or("");
    let provider=input["provider"].as_str().unwrap_or(if stage=="image"{"openai"}else{"codex"});
    let model=input["model"].as_str().unwrap_or("");
    let slide=input["slideIndex"].as_u64().map(|v|v as usize);
    let jid=id();
    {
        let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
        db.execute("INSERT INTO jobs VALUES(?1,?2,?3,?4,?5,?6,?7,'running',NULL,?8,NULL)",params![jid,client_id,project_id,slide.map(|x|x as i64),stage,provider,model,now()]).map_err(|e|ApiError::internal(e.to_string()))?;
    }
    let result:ApiResult<Value>=async{
        if stage=="draft"||stage=="revise"{
            let output=text_provider(&state,provider,model,&build_text_prompt(&project,stage,slide,input["correction"].as_str().unwrap_or(""))).await?;
            let mut next=project.clone();
            if stage=="draft"{
                let generated=output["slides"].as_array().ok_or_else(||ApiError::bad("Writing provider did not return five slides."))?;
                if generated.len()!=5{return Err(ApiError::bad("Writing provider must return exactly five slides."));}
                for i in 0..5{for k in ["heading","body","visualPrompt"]{next["slides"][i][k]=generated[i][k].clone();}next["slides"][i]["approved"]=json!(false);next["slides"][i]["artworkAssetId"]=json!("");}
                next["instagram"]=output["instagram"].clone();next["youtubeTitle"]=output["youtubeTitle"].clone();next["youtubeDescription"]=output["youtubeDescription"].clone();next["stage"]=json!(1);
            }else{
                let i=slide.ok_or_else(||ApiError::bad("slideIndex is required."))?;if i>=5{return Err(ApiError::bad("slideIndex must be 0–4."));}
                for k in ["heading","body","visualPrompt"]{next["slides"][i][k]=output[k].clone();}next["slides"][i]["approved"]=json!(false);next["slides"][i]["artworkAssetId"]=json!("");
            }
            persist_generated_project(&state,&client_id,&project_id,&project,&next)?;
            return get_project(&state,&client_id,&project_id)
        }
        if stage=="image"{
            let i=slide.ok_or_else(||ApiError::bad("slideIndex is required."))?;if i>=5{return Err(ApiError::bad("slideIndex must be 0–4."));}
            if !project["slides"][i]["approved"].as_bool().unwrap_or(false){return Err(ApiError::bad("Approve this slide before generating artwork."));}
            let template=project["templateId"].as_str().ok_or_else(||ApiError::bad("Choose a template."))?;
            let (rmime,reference)=reference_bytes(&state,&client_id,template,i)?;
            let (mime,bytes)=image_provider(&state,provider,model,&image_prompt(&project,i),&rmime,&reference).await?;
            let aid=store_asset(&state,Some(&client_id),Some(&project_id),"generated-artwork",&format!("slide-{}.png",i+1),&mime,&bytes)?;
            let mut next=project.clone();next["slides"][i]["artworkAssetId"]=json!(aid);next["slides"][i]["artworkProvider"]=json!(provider);next["slides"][i]["artworkGeneratedAt"]=json!(now());next["slides"][i]["artworkReviewed"]=json!(false);
            persist_generated_project(&state,&client_id,&project_id,&project,&next)?;
            return get_project(&state,&client_id,&project_id)
        }
        Err(ApiError::bad("Unknown job stage."))
    }.await;
    match result{
        Ok(p)=>{let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;let _=db.execute("UPDATE jobs SET status='succeeded',finished_at=?1 WHERE id=?2",params![now(),jid]);Ok(Json(json!({"job":{"id":jid,"status":"succeeded"},"project":p})))}
        Err(e)=>{let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;let _=db.execute("UPDATE jobs SET status='failed',error=?1,finished_at=?2 WHERE id=?3",params![e.message.clone(),now(),jid]);Err(e)}
    }
}

async fn list_jobs(State(state):State<AppState>,AxPath((client_id,project_id)):AxPath<(String,String)>)->ApiResult<Json<Value>>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let mut stmt=db.prepare("SELECT id,slide_index,stage,provider,model,status,error,created_at,finished_at FROM jobs WHERE client_id=?1 AND project_id=?2 ORDER BY created_at DESC LIMIT 100").map_err(|e|ApiError::internal(e.to_string()))?;
    let rows=stmt.query_map(params![client_id,project_id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"slideIndex":r.get::<_,Option<i64>>(1)?,"stage":r.get::<_,String>(2)?,"provider":r.get::<_,String>(3)?,"model":r.get::<_,Option<String>>(4)?,"status":r.get::<_,String>(5)?,"error":r.get::<_,Option<String>>(6)?,"createdAt":r.get::<_,String>(7)?,"finishedAt":r.get::<_,Option<String>>(8)?}))).map_err(|e|ApiError::internal(e.to_string()))?;
    Ok(Json(json!({"jobs":rows.filter_map(Result::ok).collect::<Vec<_>>()})))
}

async fn agy_models()->ApiResult<Json<Value>>{
    let out=Command::new("agy").arg("models").output().map_err(|_|ApiError::conflict("Antigravity CLI is not installed."))?;
    if !out.status.success(){return Err(ApiError::bad("Unable to list Antigravity models."));}
    let models=String::from_utf8_lossy(&out.stdout).lines().filter_map(|line|{let mut p=line.split_whitespace();let id=p.next()?;let label=p.collect::<Vec<_>>().join(" ");if id.contains('-'){Some(json!({"id":id,"label":if label.is_empty(){id}else{&label}}))}else{None}}).collect::<Vec<_>>();
    Ok(Json(json!({"models":models})))
}

async fn unsupported()->ApiResult<Json<Value>>{
    Err(ApiError{status:StatusCode::NOT_IMPLEMENTED,message:"Template ZIP staging and legacy migration are not yet ported to the Rust desktop core. Built-in and direct custom-reference templates work normally.".into()})
}

async fn static_file(uri:Uri)->Response{
    let mut path=uri.path().trim_start_matches('/').to_string();if path.is_empty(){path="index.html".into();}
    let file=WEB.get_file(&path).or_else(||WEB.get_file("index.html"));
    match file{
        Some(f)=>{let mime=mime_guess::from_path(&path).first_or_octet_stream().to_string();let mut res=Response::new(Body::from(f.contents().to_vec()));res.headers_mut().insert(header::CONTENT_TYPE,HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")));res.headers_mut().insert(header::X_CONTENT_TYPE_OPTIONS,HeaderValue::from_static("nosniff"));res}
        None=>StatusCode::NOT_FOUND.into_response()
    }
}

fn router(state:AppState)->Router{
    Router::new()
        .route("/api/business-packs",get(business_packs))
        .route("/api/status",get(status))
        .route("/api/dashboard",get(dashboard))
        .route("/api/all-projects",get(all_projects))
        .route("/api/templates/shared",get(shared_templates))
        .route("/api/models/agy",get(agy_models))
        .route("/api/clients",get(list_clients).post(create_client))
        .route("/api/clients/{client_id}",get(read_client).patch(update_client))
        .route("/api/clients/{client_id}/projects",get(list_projects).post(create_project))
        .route("/api/clients/{client_id}/projects/{project_id}",get(read_project).patch(save_project))
        .route("/api/clients/{client_id}/projects/{project_id}/jobs",get(list_jobs).post(run_job))
        .route("/api/clients/{client_id}/templates",get(client_templates).post(create_template))
        .route("/api/clients/{client_id}/assets",post(upload_asset))
        .route("/api/clients/{client_id}/assets/{asset_id}",get(asset))
        .route("/api/desktop/credentials/{provider}",post(save_credential).delete(delete_credential))
        .route("/api/template-imports",post(unsupported))
        .route("/api/template-imports/{id}",patch(unsupported))
        .route("/api/template-imports/{id}/install",post(unsupported))
        .fallback(get(static_file))
        .layer(RequestBodyLimitLayer::new(30 * 1024 * 1024))
        .with_state(state)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let root=app.path().app_data_dir()?.join("workspace");
            let state=init_state(root).map_err(|e|std::io::Error::other(e.message))?;
            let listener=std::net::TcpListener::bind("127.0.0.1:0")?;
            listener.set_nonblocking(true)?;
            let port=listener.local_addr()?.port();
            let tokio_listener=tokio::net::TcpListener::from_std(listener)?;
            tauri::async_runtime::spawn(async move {
                if let Err(e)=axum::serve(tokio_listener,router(state)).await { eprintln!("local server error: {e}"); }
            });
            let url=url::Url::parse(&format!("http://127.0.0.1:{port}/"))?;
            WebviewWindowBuilder::new(app,"main",WebviewUrl::External(url))
                .title("Carousel Studio")
                .inner_size(1440.0,900.0)
                .min_inner_size(960.0,650.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Carousel Studio");
}
