use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path as AxPath, Query, State},
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
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read, Write},
    collections::{HashMap,HashSet},
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tempfile::tempdir;
use tower_http::limit::RequestBodyLimitLayer;
use uuid::Uuid;
use zip::ZipArchive;

static WEB: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../web");
const KEYRING_SERVICE: &str = "com.carouselstudio.desktop";

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
    root: Arc<PathBuf>,
    downloads: Arc<PathBuf>,
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
        json!({"id":"dental","name":"Clinic — Dental","icon":"🦷","description":"Educational and service carousels for dental practices.","version":"1.0.0","defaultLanguage":"malayalam-english","languages":langs.clone(),"defaultCta":"Book a consultation","roles":["Hook","Science","Impact","Action","CTA"],"onboardingFields":[["specialty","Specialty / focus","text"],["services","Treatments / services","textarea"],["audience","Audience","text"],["approvedFacts","Approved clinical messaging","textarea"]],"topics":[["scaling","Scaling myths","Does scaling create gaps between teeth?"],["root-canal","Root canal","What should patients know about root canal treatment?"],["kids","Children's dental care","Simple dental care tips for children"]]}),
        json!({"id":"tour","name":"Tour Operator","icon":"✈️","description":"Destination, itinerary and travel-service carousels.","version":"1.0.0","defaultLanguage":"english","languages":langs.clone(),"defaultCta":"Enquire about this trip","roles":["Destination Hook","Highlights","Itinerary","Package Details","CTA"],"onboardingFields":[["destinations","Destinations","textarea"],["tripTypes","Trip types","text"],["inclusions","Typical inclusions","textarea"],["bookingContact","Booking contact","text"]],"topics":[["weekend","Weekend escape","Plan a memorable weekend escape"],["family","Family package","A family-friendly holiday package"]]}),
        json!({"id":"salon","name":"Salon","icon":"✂️","description":"Service, transformation and care carousels for salons.","version":"1.0.0","defaultLanguage":"english","languages":langs.clone(),"defaultCta":"Book a session","roles":["Desired Look","Service","Benefits","Care Tips","CTA"],"onboardingFields":[["services","Services","textarea"],["specialties","Specialties","text"],["audience","Audience","text"],["bookingContact","Booking details","text"]],"topics":[["haircare","Hair care","Simple ways to care for freshly styled hair"],["bridal","Bridal service","A polished bridal beauty service overview"]]}),
        json!({"id":"construction","name":"Construction","icon":"🏗️","description":"Service, process and verified project-showcase carousels.","version":"1.0.0","defaultLanguage":"english","languages":langs.clone(),"defaultCta":"Request a quote","roles":["Client Need","Approach","Process","Verified Work","CTA"],"onboardingFields":[["services","Services","textarea"],["serviceArea","Service area","text"],["projectTypes","Project types","textarea"],["portfolioFacts","Verified portfolio facts","textarea"]],"topics":[["build","Build process","How a well-planned project moves from idea to handover"],["renovation","Renovation","Planning a practical home renovation"]]}),
        json!({"id":"general","name":"General Business","icon":"◼️","description":"Flexible five-slide service or product storytelling.","version":"1.0.0","defaultLanguage":"english","languages":langs.clone(),"defaultCta":"Contact us","roles":["Hook","Offering","Benefits","Details","CTA"],"onboardingFields":[["services","Services / products","textarea"],["audience","Audience","text"],["preferredAction","Preferred customer action","text"],["approvedFacts","Approved business facts","textarea"]],"topics":[["service","Service overview","Introduce one of our key services"],["faq","FAQ","Answer a common customer question"]]})
    ]
}

fn pack_by_id(pack_id: &str) -> Value {
    packs().into_iter().find(|p| p["id"] == pack_id).unwrap_or_else(|| packs().pop().unwrap())
}

fn context_for_client(client:&Value)->Value {
    let pack_id=client["businessPackId"].as_str().unwrap_or("general");let pack=pack_by_id(pack_id);let profile=&client["profile"];let source=&client["brand"];
    let brand=json!({"name":source["name"].as_str().or_else(||client["name"].as_str()).unwrap_or(""),"phone":source["phone"].as_str().unwrap_or(""),"email":source["email"].as_str().unwrap_or(""),"location":source["location"].as_str().or_else(||profile["serviceArea"].as_str()).unwrap_or(""),"tagline":source["tagline"].as_str().unwrap_or(""),"primary":source["primary"].as_str().filter(|s|!s.is_empty()).unwrap_or("#073a42"),"accent":source["accent"].as_str().filter(|s|!s.is_empty()).unwrap_or("#14ada9"),"logoAssetId":source["logoAssetId"].as_str().unwrap_or("")});
    let language=profile["language"].as_str().filter(|s|!s.is_empty()).or_else(||pack["defaultLanguage"].as_str()).unwrap_or("english");
    let action=profile["preferredAction"].as_str().filter(|s|!s.is_empty()).or_else(||pack["defaultCta"].as_str()).unwrap_or("Contact us");
    let rules=match pack_id {
        "dental"=>vec!["Use measured dental wording and avoid fear. Scaling can reveal pre-existing spaces; root canal discomfort varies; wisdom teeth do not always require removal. Social content cannot diagnose symptoms."],
        "tour"=>vec!["Never invent package prices, dates, hotels, flights, inclusions, availability or visa facts."],
        "salon"=>vec!["Never invent prices, offers, testimonials, treatment outcomes or booking availability."],
        "construction"=>vec!["Never fabricate completed projects, clients, locations, timelines, costs, certifications or testimonials."],
        _=>vec!["Never invent prices, dates, testimonials, guarantees, inventory, certifications or campaign terms."],
    };
    json!({"schemaVersion":1,"businessPack":{"id":pack_id,"version":"1.0.0","name":pack["name"]},"recipe":{"id":"default","roles":pack["roles"],"slideCount":5,"aspectRatio":"4:5"},"brand":brand,"business":profile,"language":language,"tone":profile["tone"].as_str().unwrap_or("clear, helpful, professional"),"cta":{"text":action,"finalSlideOnly":true},"contentRules":rules,"resolvedAt":now()})
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

fn init_state(root: PathBuf, downloads: PathBuf) -> ApiResult<AppState> {
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
        CREATE TABLE IF NOT EXISTS template_imports(
          id TEXT PRIMARY KEY, client_id TEXT, business_pack_id TEXT NOT NULL,
          status TEXT NOT NULL, staged_path TEXT NOT NULL, preview_json TEXT NOT NULL,
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

    let dental_crops=(1..=5).map(|position|json!({"position":position,"top":0.205,"bottom":0.744,"left":0.006,"right":0.006,"gap":0.005})).collect::<Vec<_>>();
    conn.execute("UPDATE templates SET mode='board',data_json=?1 WHERE id='builtin:dental:legacy:teal-editorial-pro:1.0.0' AND client_id IS NULL",params![json_text(&json!({"staticPath":"/assets/design-systems/teal-editorial-pro.png","crops":dental_crops}))]).map_err(|e|ApiError::internal(e.to_string()))?;

    Ok(AppState {
        db: Arc::new(Mutex::new(conn)),
        root: Arc::new(root),
        downloads: Arc::new(downloads),
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
    if let Some(o)=brand.as_object_mut(){o.entry("name").or_insert(json!(name));}
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
    let context=context_for_client(&client);
    let default_template=if pack=="dental"{"builtin:dental:legacy:teal-editorial-pro:1.0.0".to_string()}else{format!("builtin:{pack}:neutral:1.0.0")};
    let project=json!({"schemaVersion":1,"topic":input["topic"].as_str().unwrap_or(""),"notes":input["notes"].as_str().unwrap_or(""),"language":input["language"].as_str().or_else(||context["language"].as_str()).unwrap_or("english"),"templateId":default_template,"slides":starter_slides(pack),"instagram":"","facebook":"","youtubeTitle":"","youtubeDescription":"","generation":{"writingProvider":"codex","writingModel":"gpt-5.6-sol","provider":"openai","model":"gpt-image-2"},"stage":0,"exportHistory":[]});
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
    let template_changed=next["templateId"]!=old["templateId"];let language_changed=next["language"]!=old["language"];
    let slides=next["slides"].as_array_mut().filter(|xs|xs.len()==5).ok_or_else(||ApiError::bad("Exactly five slides are required."))?;
    for (i,slide) in slides.iter_mut().enumerate(){
        let before=&old["slides"][i];let changed=["heading","body","visualPrompt"].iter().any(|key|slide[*key]!=before[*key]);
        if changed {slide["copyRevision"]=json!(before["copyRevision"].as_u64().unwrap_or(1)+1);slide["approved"]=json!(false);slide["approvedAt"]=json!("");}
        if changed||template_changed||language_changed {slide["artworkAssetId"]=json!("");slide["artworkReviewed"]=json!(false);slide["artworkReviewedAt"]=json!("");}
        if language_changed{slide["approved"]=json!(false);slide["approvedAt"]=json!("");}
    }
    for k in ["id","clientId","revision","archived","businessPackId","contextSnapshot","createdAt","updatedAt"]{if let Some(o)=next.as_object_mut(){o.remove(k);}}
    {
        let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
        db.execute("UPDATE projects SET revision=?1,project_json=?2,updated_at=?3 WHERE id=?4",params![expected+1,json_text(&next),now(),project_id]).map_err(|e|ApiError::internal(e.to_string()))?;
    }
    Ok(Json(json!({"project":get_project(&state,&client_id,&project_id)?})))
}

async fn apply_client_settings(State(state):State<AppState>,AxPath((client_id,project_id)):AxPath<(String,String)>,Json(input):Json<Value>)->ApiResult<Json<Value>>{
    let old=get_project(&state,&client_id,&project_id)?;let expected=input["expectedRevision"].as_i64().unwrap_or(-1);
    if expected!=old["revision"].as_i64().unwrap_or(0){return Err(ApiError::conflict("Project changed since it was loaded."));}
    let client=get_client(&state,&client_id)?;let context=context_for_client(&client);let mut stored=old.clone();
    for slide in stored["slides"].as_array_mut().ok_or_else(||ApiError::bad("Project slides are invalid."))?{slide["approved"]=json!(false);slide["approvedAt"]=json!("");slide["artworkAssetId"]=json!("");slide["artworkReviewed"]=json!(false);slide["artworkReviewedAt"]=json!("");}
    for key in ["id","clientId","revision","archived","businessPackId","contextSnapshot","createdAt","updatedAt"]{if let Some(o)=stored.as_object_mut(){o.remove(key);}}
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;db.execute("UPDATE projects SET revision=?1,context_json=?2,project_json=?3,updated_at=?4 WHERE id=?5 AND client_id=?6",params![expected+1,json_text(&context),json_text(&stored),now(),project_id,client_id]).map_err(|e|ApiError::internal(e.to_string()))?;drop(db);
    Ok(Json(json!({"project":get_project(&state,&client_id,&project_id)?})))
}

fn attach_generated_slide(state:&AppState,client_id:&str,project_id:&str,original:&Value,index:usize,asset_id:&str,provider:&str)->ApiResult<Value>{
    for _ in 0..8 {
        let current=get_project(state,client_id,project_id)?;
        if current["slides"][index]["copyRevision"]!=original["slides"][index]["copyRevision"]||current["templateId"]!=original["templateId"]||current["contextSnapshot"]!=original["contextSnapshot"]||!current["slides"][index]["approved"].as_bool().unwrap_or(false){return Err(ApiError::conflict("Slide changed while artwork was generating. Retry on the current version."));}
        let mut stored=current.clone();for key in ["id","clientId","revision","archived","businessPackId","contextSnapshot","createdAt","updatedAt"]{if let Some(o)=stored.as_object_mut(){o.remove(key);}}
        let slide=&mut stored["slides"][index];slide["artworkAssetId"]=json!(asset_id);slide["artworkProvider"]=json!(provider);slide["artworkGeneratedAt"]=json!(now());slide["artworkRevision"]=json!(slide["artworkRevision"].as_u64().unwrap_or(0)+1);slide["artworkReviewed"]=json!(false);slide["artworkReviewedAt"]=json!("");
        let revision=current["revision"].as_i64().unwrap_or(0);let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
        let updated=db.execute("UPDATE projects SET revision=?1,project_json=?2,updated_at=?3 WHERE id=?4 AND client_id=?5 AND revision=?6",params![revision+1,json_text(&stored),now(),project_id,client_id,revision]).map_err(|e|ApiError::internal(e.to_string()))?;
        drop(db);if updated==1{return get_project(state,client_id,project_id);}
    }
    Err(ApiError::conflict("Project changed during image generation. Retry the slide."))
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

fn cli_binary(name:&str,env_key:&str)->String{
    if let Some(configured)=std::env::var_os(env_key){let value=configured.to_string_lossy();if !value.trim().is_empty(){return value.into_owned();}}
    let mut dirs=std::env::var_os("PATH").map(|paths|std::env::split_paths(&paths).collect::<Vec<_>>()).unwrap_or_default();
    if let Some(home)=std::env::var_os("HOME").or_else(||std::env::var_os("USERPROFILE")){let home=PathBuf::from(home);dirs.push(home.join(".local/bin"));dirs.push(home.join(".npm-global/bin"));}
    dirs.extend([PathBuf::from("/opt/homebrew/bin"),PathBuf::from("/usr/local/bin")]);
    for dir in dirs{for ext in if cfg!(windows){vec![".exe",".cmd",".bat",""]}else{vec![""]}{let path=dir.join(format!("{name}{ext}"));if path.is_file(){return path.to_string_lossy().into_owned();}}}
    name.into()
}

async fn status()->Json<Value>{
    let codex=cli_info(&cli_binary("codex","CODEX_BIN"),true);let agy=cli_info(&cli_binary("agy","AGY_BIN"),false);
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

async fn shared_asset(State(state):State<AppState>,AxPath(asset_id):AxPath<String>)->ApiResult<Response>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let row:Option<(String,String)>=db.query_row("SELECT mime,path FROM assets WHERE id=?1 AND client_id IS NULL",params![asset_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|ApiError::internal(e.to_string()))?;
    let (mime,path)=row.ok_or_else(||ApiError::not_found("Shared template asset not found."))?;let bytes=fs::read(path).map_err(|_|ApiError::not_found("Shared template file is missing."))?;
    let mut response=Response::new(Body::from(bytes));response.headers_mut().insert(header::CONTENT_TYPE,HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")));Ok(response)
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

fn agy_binary()->String { cli_binary("agy","AGY_BIN") }

fn text_schema(task:&str)->Value {
    let slide=json!({"type":"object","properties":{"heading":{"type":"string"},"body":{"type":"string"},"visualPrompt":{"type":"string"}},"required":["heading","body","visualPrompt"],"additionalProperties":false});
    if task=="revise" {return slide;}
    json!({"type":"object","properties":{"slides":{"type":"array","items":slide,"minItems":5,"maxItems":5},"instagram":{"type":"string"},"facebook":{"type":"string"},"youtubeTitle":{"type":"string"},"youtubeDescription":{"type":"string"}},"required":["slides","instagram","facebook","youtubeTitle","youtubeDescription"],"additionalProperties":false})
}

async fn run_cli(bin:&str,args:&[String],dir:&std::path::Path,seconds:u64)->ApiResult<String>{
    let mut command=tokio::process::Command::new(bin);command.args(args).current_dir(dir).kill_on_drop(true);
    let output=tokio::time::timeout(Duration::from_secs(seconds),command.output()).await.map_err(|_|ApiError::bad(format!("{bin} timed out.")))?.map_err(|e|ApiError::bad(format!("{bin} could not start: {e}")))?;
    if !output.status.success(){let detail=String::from_utf8_lossy(if output.stderr.is_empty(){&output.stdout}else{&output.stderr});return Err(ApiError::bad(format!("{bin} exited with {}: {}",output.status,detail.chars().take(1000).collect::<String>())));}
    if output.stdout.len()>8_000_000{return Err(ApiError::bad(format!("{bin} returned too much output.")));}
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn agy_envelope(raw:&str,require_image:bool)->ApiResult<Value>{
    let envelope:Value=serde_json::from_str(raw.trim()).map_err(|_|ApiError::bad("Antigravity returned an invalid JSON response."))?;
    if envelope["status"]!="SUCCESS" {return Err(ApiError::bad(format!("Antigravity: {}",envelope["error"].as_str().or_else(||envelope["status"].as_str()).unwrap_or("unknown error"))));}
    if let Some(actions)=envelope["denied_actions"].as_array().filter(|xs|!xs.is_empty()){if require_image||(!envelope["structured_output"].is_object()&&envelope["response"].as_str().unwrap_or("").trim().is_empty()){return Err(ApiError::bad(format!("Antigravity could not complete the request because tool permission was denied: {}",actions.iter().filter_map(|x|x["display_name"].as_str().or_else(||x["action"].as_str())).collect::<Vec<_>>().join(", "))));}}
    Ok(envelope)
}

fn parse_provider_json(raw:&str)->ApiResult<Value>{
    let cleaned=raw.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    serde_json::from_str(cleaned).or_else(|_|{let start=cleaned.find('{').ok_or(())?;let end=cleaned.rfind('}').ok_or(())?;serde_json::from_str(&cleaned[start..=end]).map_err(|_|())}).map_err(|_|ApiError::bad("The provider did not return valid structured content."))
}

fn build_text_prompt(project:&Value,task:&str,slide_index:Option<usize>,correction:&str)->String{
    let context=&project["contextSnapshot"];
    let topic=project["topic"].as_str().unwrap_or("");
    let notes=project["notes"].as_str().unwrap_or("");
    let language=project["language"].as_str().unwrap_or("english");
    let roles=context["recipe"]["roles"].clone();
    let mut prompt=format!("You are a professional social-media carousel writer. Write only publication-ready copy and image concepts. Do not use tools, browse, read files or inspect the workspace. All required facts are provided here. Never invent prices, dates, claims, testimonials, statistics, results, certifications or contact details. Preserve exact business and contact values. Slides 1–4 are informational; only slide 5 may use the supplied CTA. BUSINESS CONTEXT: {}. TOPIC: {:?}. USER NOTES: {:?}. LANGUAGE: {}. Use Malayalam script for Malayalam words and Latin script for English words when mixing languages.",context,topic,notes,language);
    if task=="draft"{prompt.push_str(&format!(" Write exactly five coordinated slides with roles {}. Each slide needs a concise heading, short body and English visualPrompt describing an image without written text. Also provide separate Instagram and Facebook captions, YouTube title and YouTube description. Return ONLY JSON with fields slides, instagram, facebook, youtubeTitle, youtubeDescription. slides must contain exactly five objects with heading, body and visualPrompt.",roles));}
    else if let Some(i)=slide_index{prompt.push_str(&format!(" Rewrite only slide {} while preserving its role and verified facts. Current slide: {}. Correction: {:?}. Return ONLY a JSON object with heading, body and visualPrompt.",i+1,project["slides"][i],correction));}
    prompt
}

async fn text_provider(state:&AppState,provider:&str,model:&str,prompt:&str,task:&str)->ApiResult<Value>{
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
            let mut cmd=tokio::process::Command::new(cli_binary("codex","CODEX_BIN"));
            cmd.args(["exec","--skip-git-repo-check","--sandbox","read-only","--ephemeral"]);
            if !model.is_empty(){cmd.args(["--model",model]);}
            cmd.arg("--").arg(prompt).current_dir(dir.path());
            let out=cmd.output().await.map_err(|e|ApiError::bad(format!("Codex CLI could not start: {e}")))?;
            if !out.status.success(){return Err(ApiError::bad(String::from_utf8_lossy(&out.stderr).chars().take(800).collect::<String>()));}
            let s=String::from_utf8_lossy(&out.stdout);let start=s.find('{').unwrap_or(0);let end=s.rfind('}').map(|x|x+1).unwrap_or(s.len());
            serde_json::from_str(&s[start..end]).map_err(|e|ApiError::bad(format!("Codex returned invalid JSON: {e}")))
        },
        "antigravity"=>{
            let schema=text_schema(task);
            let request=format!("TOOL-FREE STRUCTURED-OUTPUT TASK. Do not call tools, run commands, read files, browse, or inspect the workspace. Everything required is below. Return only publication-ready JSON matching this schema: {}\n\n{}",schema,prompt);
            let dir=tempdir().map_err(|e|ApiError::internal(e.to_string()))?;
            let mut args=vec!["--disable-slash-commands".into(),"--output-format".into(),"json".into(),"--json-schema".into(),schema.to_string(),"--print-timeout".into(),"10m".into()];
            if !model.is_empty(){args.extend(["--model".into(),model.into()]);}
            args.extend(["-p".into(),request]);
            let envelope=agy_envelope(&run_cli(&agy_binary(),&args,dir.path(),660).await?,false)?;
            if envelope["structured_output"].is_object(){Ok(envelope["structured_output"].clone())}else{parse_provider_json(envelope["response"].as_str().unwrap_or(""))}
        },
        _=>Err(ApiError::bad("Unsupported writing provider."))
    }
}

fn crop_board_image(bytes:&[u8],data:&Value,slide:usize)->ApiResult<(String,Vec<u8>)>{
    let master=image::load_from_memory(bytes).map_err(|_|ApiError::bad("Board image is invalid."))?;
    let width=master.width();let height=master.height();let crop=data["crops"].as_array().and_then(|xs|xs.get(slide)).ok_or_else(||ApiError::bad("Board crop is missing."))?;
    let rect=if crop["width"].is_number()&&crop["height"].is_number(){(crop["x"].as_f64().unwrap_or(-1.0),crop["y"].as_f64().unwrap_or(-1.0),crop["width"].as_f64().unwrap_or(-1.0),crop["height"].as_f64().unwrap_or(-1.0))}else{let left=crop["left"].as_f64().unwrap_or(0.006);let right=crop["right"].as_f64().unwrap_or(0.006);let gap=crop["gap"].as_f64().unwrap_or(0.005);let panel=(1.0-left-right-gap*4.0)/5.0;(left+slide as f64*(panel+gap),crop["top"].as_f64().unwrap_or(0.0),panel,crop["bottom"].as_f64().unwrap_or(1.0)-crop["top"].as_f64().unwrap_or(0.0))};
    if rect.0<0.0||rect.1<0.0||rect.2<=0.0||rect.3<=0.0||rect.0+rect.2>1.001||rect.1+rect.3>1.001{return Err(ApiError::bad("Board crop is invalid."));}
    let x=(rect.0*width as f64).round() as u32;let y=(rect.1*height as f64).round() as u32;let w=((rect.2*width as f64).round() as u32).min(width.saturating_sub(x));let h=((rect.3*height as f64).round() as u32).min(height.saturating_sub(y));
    let mut output=Cursor::new(Vec::new());master.crop_imm(x,y,w,h).write_to(&mut output,image::ImageFormat::Png).map_err(|e|ApiError::internal(e.to_string()))?;Ok(("image/png".into(),output.into_inner()))
}

fn reference_bytes(state:&AppState,client_id:&str,template_id:&str,slide:usize)->ApiResult<(String,Vec<u8>)>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let data:String=db.query_row("SELECT data_json FROM templates WHERE id=?1 AND (client_id IS NULL OR client_id=?2)",params![template_id,client_id],|r|r.get(0)).optional().map_err(|e|ApiError::internal(e.to_string()))?.ok_or_else(||ApiError::bad("Selected template is unavailable."))?;
    let v=parse_json(data);let is_board=v["crops"].is_array();let r=if is_board{&v}else{&v["slides"][slide]};
    if let Some(path)=r["staticPath"].as_str(){
        let key=path.trim_start_matches('/');
        let f=WEB.get_file(key).ok_or_else(||ApiError::not_found("Built-in reference is missing."))?;
        if is_board{return crop_board_image(f.contents(),&v,slide);}
        return Ok((mime_guess::from_path(key).first_or_octet_stream().to_string(),f.contents().to_vec()));
    }
    if let Some(aid)=r["assetId"].as_str(){
        let row:Option<(String,String)>=db.query_row("SELECT mime,path FROM assets WHERE id=?1 AND (client_id=?2 OR client_id IS NULL)",params![aid,client_id],|rr|Ok((rr.get(0)?,rr.get(1)?))).optional().map_err(|e|ApiError::internal(e.to_string()))?;
        let (mime,path)=row.ok_or_else(||ApiError::not_found("Template asset is missing."))?;
        let bytes=fs::read(path).map_err(|_|ApiError::not_found("Template file is missing."))?;
        if is_board{return crop_board_image(&bytes,&v,slide);}
        return Ok((mime,bytes));
    }
    Err(ApiError::bad("Template reference is invalid."))
}

fn client_asset_bytes(state:&AppState,client_id:&str,asset_id:&str)->ApiResult<(String,Vec<u8>)>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let row:Option<(String,String)>=db.query_row("SELECT mime,path FROM assets WHERE id=?1 AND (client_id=?2 OR client_id IS NULL)",params![asset_id,client_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|ApiError::internal(e.to_string()))?;
    let (mime,path)=row.ok_or_else(||ApiError::not_found("Client asset is missing."))?;
    Ok((mime,fs::read(path).map_err(|_|ApiError::not_found("Client asset file is missing."))?))
}

fn board_master_bytes(state:&AppState,client_id:&str,template_id:&str)->ApiResult<Option<(String,Vec<u8>)>>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;
    let raw:Option<String>=db.query_row("SELECT data_json FROM templates WHERE id=?1 AND (client_id IS NULL OR client_id=?2)",params![template_id,client_id],|r|r.get(0)).optional().map_err(|e|ApiError::internal(e.to_string()))?;
    let data=parse_json(raw.ok_or_else(||ApiError::not_found("Template is missing."))?);
    if let Some(asset_id)=data["assetId"].as_str(){drop(db);return client_asset_bytes(state,client_id,asset_id).map(Some);}
    if let Some(path)=data["staticPath"].as_str(){let key=path.trim_start_matches('/');let file=WEB.get_file(key).ok_or_else(||ApiError::not_found("Built-in board is missing."))?;return Ok(Some((mime_guess::from_path(key).first_or_octet_stream().to_string(),file.contents().to_vec())));}
    Ok(None)
}

fn image_prompt(project:&Value,slide:usize,correction:&str,has_master:bool)->String{
    let s=&project["slides"][slide];let brand=&project["contextSnapshot"]["brand"];
    format!("Create one final publication-ready 4:5 social carousel slide {} of 5. IMAGE 1 is the selected slide layout reference. {} The last attached image, when present, is the exact client logo. Preserve it accurately. Render the approved text exactly with no extra copy. HEADING: {:?}. BODY: {:?}. BUSINESS: {:?}. PHONE only on final slide: {:?}. LOCATION only on final slide: {:?}. BRAND COLORS: primary {:?}, accent {:?}. Visual concept: {:?}. {} Do not invent claims, prices, testimonials, contact details, QR codes or extra logos. Output one flat finished slide, not a mockup.",slide+1,if has_master{"IMAGE 2 is the complete five-slide board. Use it for shared typography, palette and footer position; render only one slide."}else{""},s["heading"].as_str().unwrap_or(""),s["body"].as_str().unwrap_or(""),brand["name"].as_str().unwrap_or(""),if slide==4{brand["phone"].as_str().unwrap_or("")}else{""},if slide==4{brand["location"].as_str().unwrap_or("")}else{""},brand["primary"].as_str().unwrap_or(""),brand["accent"].as_str().unwrap_or(""),s["visualPrompt"].as_str().unwrap_or(""),if correction.trim().is_empty(){String::new()}else{format!("REGENERATION REQUEST: Apply this visual change while preserving all approved copy and brand rules: {}.",correction.trim())})
}

fn find_b64(v:&Value)->Option<String>{
    if let Some(s)=v.get("b64_json").and_then(Value::as_str){return Some(s.to_string())}
    if let Some(s)=v.get("data").and_then(Value::as_str){if s.len()>1000{return Some(s.to_string())}}
    match v{Value::Array(a)=>a.iter().find_map(find_b64),Value::Object(m)=>m.values().find_map(find_b64),_=>None}
}

fn image_file_name(stem:&str,mime:&str)->String {
    format!("{stem}.{}",match mime{"image/jpeg"=>"jpg","image/webp"=>"webp",_=>"png"})
}

async fn image_provider(state:&AppState,provider:&str,model:&str,prompt:&str,mime:&str,reference:&[u8],master:Option<&(String,Vec<u8>)>,logo:Option<&(String,Vec<u8>)>)->ApiResult<(String,Vec<u8>)>{
    match provider{
        "openai"=>{
            let key=key_for("openai")?;let m=if model.is_empty(){"gpt-image-2"}else{model};
            let part=multipart::Part::bytes(reference.to_vec()).file_name("reference.png").mime_str(mime).map_err(|e|ApiError::internal(e.to_string()))?;
            let mut form=multipart::Form::new().text("model",m.to_string()).text("prompt",prompt.to_string()).text("size",if m=="gpt-image-2"{"1024x1280"}else{"1024x1536"}).text("quality","high").text("output_format","png").part("image[]",part);
            if let Some((mime,bytes))=master{form=form.part("image[]",multipart::Part::bytes(bytes.clone()).file_name("master.png").mime_str(mime).map_err(|e|ApiError::internal(e.to_string()))?);}
            if let Some((mime,bytes))=logo{form=form.part("image[]",multipart::Part::bytes(bytes.clone()).file_name("logo.png").mime_str(mime).map_err(|e|ApiError::internal(e.to_string()))?);}
            let r=state.http.post("https://api.openai.com/v1/images/edits").bearer_auth(key).multipart(form).send().await.map_err(|e|ApiError::internal(e.to_string()))?;
            let status=r.status();let v:Value=r.json().await.map_err(|e|ApiError::internal(e.to_string()))?;
            if !status.is_success(){return Err(ApiError::bad(v["error"]["message"].as_str().unwrap_or("OpenAI image request failed.")));}
            let b64=v["data"][0]["b64_json"].as_str().ok_or_else(||ApiError::bad("OpenAI returned no image."))?;
            Ok(("image/png".into(),B64.decode(b64).map_err(|_|ApiError::bad("OpenAI returned invalid image bytes."))?))
        },
        "gemini"=>{
            let key=key_for("gemini")?;let m=if model.is_empty(){"gemini-3.1-flash-image"}else{model};
            let mut input=vec![json!({"type":"text","text":prompt}),json!({"type":"image","mime_type":mime,"data":B64.encode(reference)})];
            if let Some((mime,bytes))=master{input.push(json!({"type":"image","mime_type":mime,"data":B64.encode(bytes)}));}
            if let Some((mime,bytes))=logo{input.push(json!({"type":"image","mime_type":mime,"data":B64.encode(bytes)}));}
            let body=json!({"model":m,"input":input,"response_format":{"type":"image","mime_type":"image/png","aspect_ratio":"4:5","image_size":"2K"}});
            let r=state.http.post("https://generativelanguage.googleapis.com/v1beta/interactions").header("x-goog-api-key",key).json(&body).send().await.map_err(|e|ApiError::internal(e.to_string()))?;
            let status=r.status();let v:Value=r.json().await.map_err(|e|ApiError::internal(e.to_string()))?;
            if !status.is_success(){return Err(ApiError::bad(v["error"]["message"].as_str().unwrap_or("Gemini image request failed.")));}
            let b64=find_b64(&v).ok_or_else(||ApiError::bad("Gemini returned no image."))?;
            Ok(("image/png".into(),B64.decode(b64).map_err(|_|ApiError::bad("Gemini returned invalid image bytes."))?))
        },
        "codex"=>{
            let dir=tempdir().map_err(|e|ApiError::internal(e.to_string()))?;let ref_path=dir.path().join(image_file_name("reference",mime));let out_path=dir.path().join("final-slide.png");
            let git=tokio::process::Command::new("git").args(["init","-q"]).current_dir(dir.path()).output().await.map_err(|e|ApiError::bad(format!("Codex workspace setup failed: {e}")))?;
            if !git.status.success(){return Err(ApiError::bad(format!("Codex workspace setup failed: {}",String::from_utf8_lossy(&git.stderr).trim())));}
            fs::write(&ref_path,reference).map_err(|e|ApiError::internal(e.to_string()))?;
            let mut image_paths=vec![ref_path.clone()];
            if let Some((mime,bytes))=master{let path=dir.path().join(image_file_name("master",mime));fs::write(&path,bytes).map_err(|e|ApiError::internal(e.to_string()))?;image_paths.push(path);}
            if let Some((mime,bytes))=logo{let path=dir.path().join(image_file_name("logo",mime));fs::write(&path,bytes).map_err(|e|ApiError::internal(e.to_string()))?;image_paths.push(path);}
            let instruction=format!("$imagegen\nGenerate ONE finished image using high quality and save it exactly as final-slide.png in the current directory. Inspect the attached references in order as the selected slide, optional full board, and exact logo. Use Codex built-in image generation. Do not call the OpenAI API manually. Do not merely describe it.\n\n{prompt}");
            let mut cmd=tokio::process::Command::new(cli_binary("codex","CODEX_BIN"));cmd.args(["exec","--ephemeral","--sandbox","workspace-write","--image"]);for path in &image_paths{cmd.arg(path);}
            if !model.is_empty(){cmd.args(["--model",model]);}
            cmd.arg("--").arg(instruction).current_dir(dir.path()).env("CI","1").env_remove("OPENAI_API_KEY").env_remove("CODEX_API_KEY").kill_on_drop(true);
            let out=tokio::time::timeout(Duration::from_secs(900),cmd.output()).await.map_err(|_|ApiError::bad("Codex image generation timed out after 15 minutes."))?.map_err(|e|ApiError::bad(format!("Codex CLI could not start: {e}")))?;
            if !out.status.success(){let detail=if out.stderr.is_empty(){&out.stdout}else{&out.stderr};return Err(ApiError::bad(format!("Codex image generation failed: {}",String::from_utf8_lossy(detail).chars().take(1000).collect::<String>())));}
            let bytes=fs::read(out_path).map_err(|_|ApiError::bad("Codex finished without creating final-slide.png. Check Codex login and image generation access."))?;
            if bytes.len()<10_000{return Err(ApiError::bad("Codex created an unusable image."));}
            Ok(("image/png".into(),bytes))
        },
        "antigravity"=>{
            let dir=tempdir().map_err(|e|ApiError::internal(e.to_string()))?;
            let mut paths=vec![image_file_name("template",mime)];fs::write(dir.path().join(&paths[0]),reference).map_err(|e|ApiError::internal(e.to_string()))?;
            if let Some((mime,bytes))=master{let name=image_file_name("master",mime);fs::write(dir.path().join(&name),bytes).map_err(|e|ApiError::internal(e.to_string()))?;paths.push(name);}
            if let Some((mime,bytes))=logo{let name=image_file_name("logo",mime);fs::write(dir.path().join(&name),bytes).map_err(|e|ApiError::internal(e.to_string()))?;paths.push(name);}
            let target=dir.path().join("final-slide.png");
            let (image_model,image_name)=match model{"gemini-3.1-flash-image"=>(model,"Nano Banana 2"),"gemini-3.1-flash-lite-image"=>(model,"Nano Banana 2 Lite"),"gemini-2.5-flash-image"=>(model,"Nano Banana"),_=>("gemini-3-pro-image","Nano Banana Pro")};
            let instruction=format!("Call the native generate_image tool to create the final image described below. Request {image_name} ({image_model}) for image generation. Pass ImageName exactly as \"final-slide.png\" and ImagePaths exactly as {}. Use the closest supported portrait aspect ratio and keep all content inside a 4:5 safe area. The required final file is {}. Do not only describe the image; actually create the file.\n\n{prompt}",json!(paths),target.display());
            let mut args=vec!["--mode".into(),"accept-edits".into(),"--sandbox".into(),"--dangerously-skip-permissions".into(),"--output-format".into(),"json".into()];
            args.extend(["--print-timeout".into(),"10m".into(),"-p".into(),instruction]);
            agy_envelope(&run_cli(&agy_binary(),&args,dir.path(),660).await?,true)?;
            let bytes=fs::read(target).map_err(|_|ApiError::bad("Antigravity finished without creating final-slide.png. Check native generate_image tool access."))?;
            if bytes.len()<10_000{return Err(ApiError::bad("Antigravity created an unusable image."));}
            Ok(("image/png".into(),bytes))
        },
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
            let output=text_provider(&state,provider,model,&build_text_prompt(&project,stage,slide,input["correction"].as_str().unwrap_or("")),stage).await?;
            let mut next=project.clone();
            if stage=="draft"{
                let generated=output["slides"].as_array().ok_or_else(||ApiError::bad("Writing provider did not return five slides."))?;
                if generated.len()!=5{return Err(ApiError::bad("Writing provider must return exactly five slides."));}
                for i in 0..5{for k in ["heading","body","visualPrompt"]{next["slides"][i][k]=generated[i][k].clone();}next["slides"][i]["copyRevision"]=json!(project["slides"][i]["copyRevision"].as_u64().unwrap_or(1)+1);next["slides"][i]["approved"]=json!(false);next["slides"][i]["approvedAt"]=json!("");next["slides"][i]["artworkAssetId"]=json!("");next["slides"][i]["artworkReviewed"]=json!(false);}
                next["instagram"]=output["instagram"].clone();next["facebook"]=output["facebook"].clone();next["youtubeTitle"]=output["youtubeTitle"].clone();next["youtubeDescription"]=output["youtubeDescription"].clone();next["stage"]=json!(1);
            }else{
                let i=slide.ok_or_else(||ApiError::bad("slideIndex is required."))?;if i>=5{return Err(ApiError::bad("slideIndex must be 0–4."));}
                for k in ["heading","body","visualPrompt"]{next["slides"][i][k]=output[k].clone();}next["slides"][i]["copyRevision"]=json!(project["slides"][i]["copyRevision"].as_u64().unwrap_or(1)+1);next["slides"][i]["approved"]=json!(false);next["slides"][i]["approvedAt"]=json!("");next["slides"][i]["artworkAssetId"]=json!("");next["slides"][i]["artworkReviewed"]=json!(false);
            }
            persist_generated_project(&state,&client_id,&project_id,&project,&next)?;
            return get_project(&state,&client_id,&project_id)
        }
        if stage=="image"{
            let i=slide.ok_or_else(||ApiError::bad("slideIndex is required."))?;if i>=5{return Err(ApiError::bad("slideIndex must be 0–4."));}
            if !project["slides"][i]["approved"].as_bool().unwrap_or(false){return Err(ApiError::bad("Approve this slide before generating artwork."));}
            let template=project["templateId"].as_str().ok_or_else(||ApiError::bad("Choose a template."))?;
            let (rmime,reference)=reference_bytes(&state,&client_id,template,i)?;
            let master=board_master_bytes(&state,&client_id,template)?;
            let logo=project["contextSnapshot"]["brand"]["logoAssetId"].as_str().map(|asset_id|client_asset_bytes(&state,&client_id,asset_id)).transpose()?;
            let prompt=image_prompt(&project,i,input["correction"].as_str().unwrap_or(""),master.is_some());
            let (mime,bytes)=image_provider(&state,provider,model,&prompt,&rmime,&reference,master.as_ref(),logo.as_ref()).await?;
            let aid=store_asset(&state,Some(&client_id),Some(&project_id),"generated-artwork",&format!("slide-{}.png",i+1),&mime,&bytes)?;
            return attach_generated_slide(&state,&client_id,&project_id,&project,i,&aid,provider)
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
    let out=Command::new(agy_binary()).arg("models").output().map_err(|_|ApiError::conflict("Antigravity CLI is not installed."))?;
    if !out.status.success(){return Err(ApiError::bad("Unable to list Antigravity models."));}
    let models=String::from_utf8_lossy(&out.stdout).lines().filter_map(|line|{let mut p=line.split_whitespace();let id=p.next()?;let label=p.collect::<Vec<_>>().join(" ");if id.contains('-'){Some(json!({"id":id,"label":if label.is_empty(){id}else{&label}}))}else{None}}).collect::<Vec<_>>();
    Ok(Json(json!({"models":models})))
}

#[derive(Deserialize)]
struct TemplateImportQuery { #[serde(rename="clientId")] client_id: Option<String>, #[serde(rename="businessPackId")] business_pack_id: Option<String>, scope: Option<String> }

fn imported_image_info(bytes:&[u8])->ApiResult<(&'static str,usize,usize)>{
    if bytes.len()>20_000_000{return Err(ApiError::bad("Image exceeds the 20 MB per-file limit."));}
    if bytes.len()>=24&&bytes[..8]==[137,80,78,71,13,10,26,10]{return Ok(("image/png",u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as usize,u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as usize));}
    if bytes.len()>12&&bytes[..4]==*b"RIFF"&&bytes[8..12]==*b"WEBP"{return Ok(("image/webp",0,0));}
    if bytes.len()>4&&bytes[0]==0xff&&bytes[1]==0xd8{return Ok(("image/jpeg",0,0));}
    Err(ApiError::bad("Only PNG, JPEG and WebP image files are supported."))
}

fn zip_entries(bytes:&[u8])->ApiResult<Vec<(String,Vec<u8>)>>{
    if bytes.len()>90_000_000{return Err(ApiError{status:StatusCode::PAYLOAD_TOO_LARGE,message:"Template ZIP is too large.".into()});}
    let mut zip=ZipArchive::new(Cursor::new(bytes)).map_err(|_|ApiError::bad("Invalid ZIP design package."))?;
    if zip.len()>200{return Err(ApiError::bad("Template ZIP has too many files."));}
    let mut entries=Vec::new();let mut total=0usize;let mut seen=HashSet::new();
    for i in 0..zip.len(){let mut file=zip.by_index(i).map_err(|_|ApiError::bad("Invalid ZIP entry."))?;let name=file.name().replace('\\',"/");
        if file.is_dir(){continue;}
        if name.is_empty()||name.starts_with('/')||name.starts_with("../")||name.contains("/../")||name.contains(':')||name.split('/').any(|part|part==".."||part=="."){return Err(ApiError::bad("Unsafe ZIP path."));}
        if !seen.insert(name.clone()){return Err(ApiError::bad(format!("Duplicate ZIP path: {name}")));}
        if file.unix_mode().is_some_and(|mode|mode&0o170000==0o120000){return Err(ApiError::bad("Symlinks are not allowed in template ZIPs."));}
        let size=usize::try_from(file.size()).map_err(|_|ApiError::bad("ZIP entry is too large."))?;total=total.checked_add(size).ok_or_else(||ApiError::bad("Expanded ZIP is too large."))?;if total>220_000_000{return Err(ApiError::bad("Expanded ZIP is too large."));}
        let mut data=Vec::with_capacity(size);file.read_to_end(&mut data).map_err(|_|ApiError::bad("Unable to read ZIP entry."))?;if data.len()!=size{return Err(ApiError::bad("ZIP size mismatch."));}entries.push((name,data));}
    Ok(entries)
}

fn validate_template_mappings(templates:&[Value],images:&HashSet<String>)->ApiResult<()> {
    if templates.is_empty(){return Err(ApiError::bad("Map at least one template before installation."));}
    for template in templates {
        match template["mode"].as_str() {
            Some("slides")=>{
                let slides=template["slides"].as_array().filter(|xs|xs.len()==5).ok_or_else(||ApiError::bad("A slide style needs exactly five images."))?;
                let mut positions=HashSet::new();for slide in slides{let position=slide["position"].as_u64().ok_or_else(||ApiError::bad("Slide position is missing."))?;if !(1..=5).contains(&position)||!positions.insert(position){return Err(ApiError::bad("Slide positions must be 1 through 5."));}let image=slide["image"].as_str().ok_or_else(||ApiError::bad("Slide image is missing."))?;if !images.contains(image){return Err(ApiError::bad(format!("Missing image {image}.")));}}
            },
            Some("board")=>{
                let name=template["image"].as_str().ok_or_else(||ApiError::bad("Board image is missing."))?;if !images.contains(name){return Err(ApiError::bad(format!("Missing image {name}.")));}
                let crops=template["crops"].as_array().filter(|xs|xs.len()==5).ok_or_else(||ApiError::bad("A board style needs five crops."))?;
                for crop in crops{let rect=if crop["width"].is_number(){let x=crop["x"].as_f64().unwrap_or(-1.0);let y=crop["y"].as_f64().unwrap_or(-1.0);let w=crop["width"].as_f64().unwrap_or(-1.0);let h=crop["height"].as_f64().unwrap_or(-1.0);(x,y,w,h)}else{let left=crop["left"].as_f64().unwrap_or(-1.0);let right=crop["right"].as_f64().unwrap_or(-1.0);let gap=crop["gap"].as_f64().unwrap_or(-1.0);let top=crop["top"].as_f64().unwrap_or(-1.0);let bottom=crop["bottom"].as_f64().unwrap_or(-1.0);(left,top,(1.0-left-right-gap*4.0)/5.0,bottom-top)};if rect.0<0.0||rect.1<0.0||rect.2<=0.0||rect.3<=0.0||rect.0+rect.2>1.001||rect.1+rect.3>1.001{return Err(ApiError::bad("Board crop must stay within the image."));}}
            },
            _=>return Err(ApiError::bad("Template mode must be slides or board.")),
        }
    }
    Ok(())
}

fn import_preview(entries:&[(String,Vec<u8>)],pack:&str)->ApiResult<Value>{
    let mut images=Vec::new();for (name,data) in entries {if name.starts_with("__MACOSX/")||name==".DS_Store"||name.ends_with(".json")||name.ends_with(".txt")||name.ends_with(".md"){continue};let (mime,width,height)=imported_image_info(data).map_err(|e|ApiError::bad(format!("{name}: {}",e.message)))?;images.push(json!({"name":name,"size":data.len(),"mime":mime,"width":width,"height":height}));}
    if images.is_empty(){return Err(ApiError::bad("No supported images were found in the ZIP."));}
    if let Some((_,raw))=entries.iter().find(|(name,_)|name=="pack.json"){
        let manifest:Value=serde_json::from_slice(raw).map_err(|_|ApiError::bad("pack.json is not valid JSON."))?;
        if manifest["schemaVersion"]!=1 || !manifest["id"].is_string() || !manifest["version"].is_string() || !manifest["templates"].is_array(){return Err(ApiError::bad("pack.json requires schemaVersion 1, id, version and templates."));}
        let names=images.iter().filter_map(|image|image["name"].as_str().map(str::to_string)).collect();validate_template_mappings(manifest["templates"].as_array().unwrap(),&names)?;
        return Ok(json!({"kind":"manifest","manifest":manifest,"images":images,"unresolved":false}));
    }
    let legacy=[("teal-editorial-pro",0.205,0.744),("clinical-white",0.205,0.752),("warm-ivory",0.064,0.811),("deep-teal-premium",0.181,0.848),("mint-friendly",0.158,0.864),("airy-aqua",0.160,0.824),("kids-mint",0.177,0.866),("nature-sage",0.172,0.826),("warm-clinical",0.205,0.915),("premium-charcoal",0.163,0.736)];
    if legacy.iter().all(|(id,_,_)|images.iter().any(|image|image["name"].as_str().is_some_and(|name|name.ends_with(&format!("{id}.png"))))) {
        let templates=legacy.iter().map(|(id,top,bottom)|{let image=images.iter().find(|image|image["name"].as_str().is_some_and(|name|name.ends_with(&format!("{id}.png")))).unwrap();json!({"id":id,"name":id.replace('-'," "),"mode":"board","image":image["name"],"crops":(1..=5).map(|position|json!({"position":position,"top":top,"bottom":bottom,"left":0.006,"right":0.006,"gap":0.005})).collect::<Vec<_>>()})}).collect::<Vec<_>>();
        return Ok(json!({"kind":"legacy-smilecraft","images":images,"unresolved":false,"packId":"smilecraft-masters","version":"1.0.0","templates":templates}));
    }
    if images.len()==5 {let mut sorted=images.clone();sorted.sort_by(|a,b|a["name"].as_str().cmp(&b["name"].as_str()));return Ok(json!({"kind":"image-only","images":images,"unresolved":false,"packId":format!("{pack}-import"),"version":"1.0.0","templates":[{"id":"five-slide-reference","name":"Five-slide reference","mode":"slides","slides":sorted.iter().enumerate().map(|(i,x)|json!({"position":i+1,"image":x["name"]})).collect::<Vec<_>>()}]}));}
    Ok(json!({"kind":"image-only","images":images,"unresolved":true,"packId":format!("{pack}-import"),"version":"1.0.0","templates":[]}))
}

async fn stage_template_import(State(state):State<AppState>,Query(query):Query<TemplateImportQuery>,bytes:Bytes)->ApiResult<Json<Value>>{
    let scope=query.scope.as_deref().unwrap_or("client");if scope!="client"&&scope!="shared"{return Err(ApiError::bad("Template scope must be client or shared."));}
    let client_id=if scope=="shared"{None}else{Some(query.client_id.ok_or_else(||ApiError::bad("Client scope requires clientId."))?)};
    let client=client_id.as_deref().map(|id|get_client(&state,id)).transpose()?;
    let pack=query.business_pack_id.or_else(||client.as_ref().and_then(|c|c["businessPackId"].as_str().map(str::to_string))).ok_or_else(||ApiError::bad("Choose a business type for the template pack."))?;
    if !packs().iter().any(|p|p["id"]==pack){return Err(ApiError::bad("Unknown business type."));}
    let entries=zip_entries(&bytes)?;let preview=import_preview(&entries,&pack)?;let iid=id();let dir=state.root.join("template-imports").join(&iid);fs::create_dir_all(&dir).map_err(|e|ApiError::internal(e.to_string()))?;let staged=dir.join("pack.zip");fs::write(&staged,&bytes).map_err(|e|ApiError::internal(e.to_string()))?;
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;db.execute("INSERT INTO template_imports VALUES(?1,?2,?3,'staged',?4,?5,?6)",params![iid,client_id,pack,staged.to_string_lossy(),json_text(&preview),now()]).map_err(|e|ApiError::internal(e.to_string()))?;
    Ok(Json(json!({"id":iid,"preview":preview,"duplicate":false})))
}

async fn update_template_import(State(state):State<AppState>,AxPath(import_id):AxPath<String>,Json(patch):Json<Value>)->ApiResult<Json<Value>>{
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;let row:Option<(String,String)>=db.query_row("SELECT status,preview_json FROM template_imports WHERE id=?1",params![import_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|ApiError::internal(e.to_string()))?;let Some((status,raw))=row else{return Err(ApiError::not_found("Template import not found."));};if status!="staged"{return Err(ApiError::conflict("Template import is no longer editable."));}let mut preview=parse_json(raw);if let Some(t)=patch.get("templates").filter(|x|x.is_array()){preview["templates"]=t.clone();}if preview["templates"].as_array().is_none_or(|x|x.is_empty()){return Err(ApiError::bad("Map at least one template before installation."));}db.execute("UPDATE template_imports SET preview_json=?1 WHERE id=?2",params![json_text(&preview),import_id]).map_err(|e|ApiError::internal(e.to_string()))?;Ok(Json(json!({"preview":preview})))
}

async fn install_template_import(State(state):State<AppState>,AxPath(import_id):AxPath<String>)->ApiResult<Json<Value>>{
    let (client_id,pack,status,staged,raw)={let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;db.query_row("SELECT client_id,business_pack_id,status,staged_path,preview_json FROM template_imports WHERE id=?1",params![import_id],|r|Ok((r.get::<_,Option<String>>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?))).optional().map_err(|e|ApiError::internal(e.to_string()))?.ok_or_else(||ApiError::not_found("Template import not found."))?};
    if status=="installed"{return Ok(Json(json!({"ok":true,"idempotent":true})));}if status!="staged"{return Err(ApiError::conflict("Template import is not installable."));}
    let preview=parse_json(raw);let source=&preview["manifest"];let templates=source["templates"].as_array().or_else(||preview["templates"].as_array()).filter(|x|!x.is_empty()).ok_or_else(||ApiError::bad("Template mappings are incomplete."))?;
    let entries=zip_entries(&fs::read(staged).map_err(|_|ApiError::not_found("Staged ZIP is missing."))?)?;let files:HashMap<String,Vec<u8>>=entries.into_iter().collect();let pack_id=source["id"].as_str().or_else(||preview["packId"].as_str()).unwrap_or("imported-pack");let version=source["version"].as_str().or_else(||preview["version"].as_str()).unwrap_or("1.0.0");let mut installed=Vec::new();
    for template in templates {
        let mode=template["mode"].as_str().ok_or_else(||ApiError::bad("Template mode is missing."))?;
        let names:Vec<&str>=match mode {
            "slides"=>template["slides"].as_array().filter(|x|x.len()==5).ok_or_else(||ApiError::bad("Each slide style needs exactly five images."))?.iter().map(|s|s["image"].as_str().ok_or_else(||ApiError::bad("Slide image is missing."))).collect::<ApiResult<_>>()?,
            "board"=>vec![template["image"].as_str().ok_or_else(||ApiError::bad("Board image is missing."))?],
            _=>return Err(ApiError::bad("Template mode must be slides or board.")),
        };
        let tid=format!("{}:{}:{}:{}",pack_id,template["id"].as_str().unwrap_or("template"),version,client_id.as_deref().unwrap_or("_shared"));
        let checksum=format!("{:x}",Sha256::digest(json_text(&json!({"mapping":template,"images":names.iter().map(|name|files.get(*name).map(|bytes|format!("{:x}",Sha256::digest(bytes)))).collect::<Vec<_>>()}))));
        let existing:Option<String>={let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;db.query_row("SELECT checksum FROM templates WHERE id=?1",params![tid],|r|r.get(0)).optional().map_err(|e|ApiError::internal(e.to_string()))?};
        if let Some(old)=existing {if old!=checksum{return Err(ApiError::conflict("This template version already exists with different content. Use a new pack version."));}installed.push(json!({"id":tid,"name":template["name"]}));continue;}
        let mut assets=Vec::new();for name in names {let bytes=files.get(name).ok_or_else(||ApiError::bad(format!("Missing image {name}.")))?;let (mime,_,_)=imported_image_info(bytes)?;assets.push(store_asset(&state,client_id.as_deref(),None,"template-reference",name,mime,bytes)?);}
        let data=if mode=="slides"{json!({"slides":assets.iter().enumerate().map(|(i,asset_id)|json!({"position":i+1,"assetId":asset_id})).collect::<Vec<_>>()})}else{json!({"assetId":assets[0],"crops":template["crops"]})};
        let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;db.execute("INSERT INTO templates VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![tid,client_id,template["name"].as_str().unwrap_or("Imported style"),pack,mode,json_text(&data),checksum,now()]).map_err(|e|ApiError::internal(e.to_string()))?;installed.push(json!({"id":tid,"name":template["name"]}));
    }
    let db=state.db.lock().map_err(|_|ApiError::internal("Database lock failed"))?;db.execute("UPDATE template_imports SET status='installed' WHERE id=?1",params![import_id]).map_err(|e|ApiError::internal(e.to_string()))?;Ok(Json(json!({"ok":true,"idempotent":false,"templates":installed})))
}

async fn static_file(uri:Uri)->Response{
    let mut path=uri.path().trim_start_matches('/').to_string();if path.is_empty(){path="index.html".into();}
    let file=WEB.get_file(&path).or_else(||WEB.get_file("index.html"));
    match file{
        Some(f)=>{let mime=mime_guess::from_path(&path).first_or_octet_stream().to_string();let mut res=Response::new(Body::from(f.contents().to_vec()));res.headers_mut().insert(header::CONTENT_TYPE,HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")));res.headers_mut().insert(header::X_CONTENT_TYPE_OPTIONS,HeaderValue::from_static("nosniff"));res}
        None=>StatusCode::NOT_FOUND.into_response()
    }
}

async fn save_desktop_export(State(state):State<AppState>, body:Bytes)->ApiResult<Json<Value>>{
    if body.len()<100 || body.len()>90_000_000{return Err(ApiError::bad("Carousel ZIP is empty or too large."));}
    let mut archive=ZipArchive::new(Cursor::new(body.as_ref())).map_err(|_|ApiError::bad("Carousel ZIP is invalid."))?;
    let expected:HashSet<String>=(1..=5).map(|i|format!("slide-{i}.png")).chain(["instagram-caption.txt","facebook-caption.txt","project.json"].into_iter().map(str::to_string)).collect();
    let actual:HashSet<String>=(0..archive.len()).map(|i|archive.by_index(i).map(|file|file.name().to_string())).collect::<Result<_,_>>().map_err(|_|ApiError::bad("Carousel ZIP is invalid."))?;
    if archive.len()!=8 || actual!=expected{return Err(ApiError::bad("Carousel ZIP must contain five slides, Instagram and Facebook captions, and project.json."));}
    fs::create_dir_all(state.downloads.as_ref()).map_err(|e|ApiError::internal(format!("Cannot access Downloads folder: {e}")))?;
    let filename=format!("carousel-{}-{}.zip",Utc::now().format("%Y-%m-%d-%H%M%S"),&id()[..8]);
    let path=state.downloads.join(&filename);
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e|ApiError::internal(format!("Cannot create carousel ZIP in Downloads: {e}")))?;
    if let Err(e)=file.write_all(&body).and_then(|_|file.sync_all()){let _=fs::remove_file(&path);return Err(ApiError::internal(format!("Cannot save carousel ZIP: {e}")));}
    Ok(Json(json!({"filename":filename,"path":path.to_string_lossy(),"bytes":body.len()})))
}

fn router(state:AppState)->Router{
    Router::new()
        .route("/api/business-packs",get(business_packs))
        .route("/api/status",get(status))
        .route("/api/dashboard",get(dashboard))
        .route("/api/all-projects",get(all_projects))
        .route("/api/templates/shared",get(shared_templates))
        .route("/api/template-assets/{asset_id}",get(shared_asset))
        .route("/api/models/agy",get(agy_models))
        .route("/api/clients",get(list_clients).post(create_client))
        .route("/api/clients/{client_id}",get(read_client).patch(update_client))
        .route("/api/clients/{client_id}/projects",get(list_projects).post(create_project))
        .route("/api/clients/{client_id}/projects/{project_id}",get(read_project).patch(save_project))
        .route("/api/clients/{client_id}/projects/{project_id}/apply-client-settings",post(apply_client_settings))
        .route("/api/clients/{client_id}/projects/{project_id}/jobs",get(list_jobs).post(run_job))
        .route("/api/clients/{client_id}/templates",get(client_templates).post(create_template))
        .route("/api/clients/{client_id}/assets",post(upload_asset))
        .route("/api/clients/{client_id}/assets/{asset_id}",get(asset))
        .route("/api/desktop/credentials/{provider}",post(save_credential).delete(delete_credential))
        .route("/api/desktop/exports",post(save_desktop_export))
        .route("/api/template-imports",post(stage_template_import))
        .route("/api/template-imports/{id}",patch(update_template_import))
        .route("/api/template-imports/{id}/install",post(install_template_import))
        .fallback(get(static_file))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(90 * 1024 * 1024))
        .with_state(state)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let root=app.path().app_data_dir()?.join("workspace");
            let downloads=app.path().download_dir()?;
            let state=init_state(root,downloads).map_err(|e|std::io::Error::other(e.message))?;
            let listener=std::net::TcpListener::bind("127.0.0.1:0")?;
            listener.set_nonblocking(true)?;
            let port=listener.local_addr()?.port();
            tauri::async_runtime::spawn(async move {
                let tokio_listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(listener) => listener,
                    Err(e) => {
                        eprintln!("failed to start local listener: {e}");
                        return;
                    }
                };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn desktop_export_is_saved_and_reports_its_path() {
        let root=tempdir().unwrap();
        let downloads=root.path().join("Downloads");
        let state=init_state(root.path().join("workspace"),downloads.clone()).unwrap();
        let cursor=Cursor::new(Vec::new());
        let mut writer=zip::ZipWriter::new(cursor);
        for name in (1..=5).map(|i|format!("slide-{i}.png")).chain(["instagram-caption.txt","facebook-caption.txt","project.json"].into_iter().map(str::to_string)) {
            writer.start_file(name,zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(b"test export content").unwrap();
        }
        let bytes=writer.finish().unwrap().into_inner();
        let result=save_desktop_export(State(state),Bytes::from(bytes.clone())).await.unwrap().0;
        let saved=PathBuf::from(result["path"].as_str().unwrap());
        assert_eq!(saved.parent(),Some(downloads.as_path()));
        assert_eq!(fs::read(saved).unwrap(),bytes);
        assert_eq!(result["bytes"],bytes.len());
        assert_eq!(text_schema("draft")["required"].as_array().unwrap().iter().any(|field|field=="facebook"),true);
    }

    #[test]
    fn antigravity_envelope_extracts_structured_content_and_reports_denial() {
        let value=agy_envelope(r#"{"status":"SUCCESS","structured_output":{"heading":"Hello","body":"World","visualPrompt":"Portrait"}}"#,false).unwrap();
        assert_eq!(value["structured_output"]["heading"],"Hello");
        assert!(agy_envelope(r#"{"status":"SUCCESS","denied_actions":[{"action":"generate_image"}]}"#,true).is_err());
    }

    #[tokio::test]
    async fn independent_artwork_results_merge_into_one_project() {
        let root=tempdir().unwrap();let state=init_state(root.path().join("workspace"),root.path().join("Downloads")).unwrap();
        let client=create_client(State(state.clone()),Json(json!({"name":"Test clinic","businessPackId":"dental"}))).await.unwrap().0["client"]["id"].as_str().unwrap().to_string();
        let project=create_project(State(state.clone()),AxPath(client.clone()),Json(json!({}))).await.unwrap().0["project"].clone();
        let project_id=project["id"].as_str().unwrap();
        let mut approved=project.clone();approved["slides"][0]["approved"]=json!(true);approved["slides"][1]["approved"]=json!(true);
        let saved=save_project(State(state.clone()),AxPath((client.clone(),project_id.into())),Json(json!({"expectedRevision":project["revision"],"slides":approved["slides"]}))).await.unwrap().0["project"].clone();
        attach_generated_slide(&state,&client,project_id,&saved,0,"asset-one","openai").unwrap();
        let latest=attach_generated_slide(&state,&client,project_id,&saved,1,"asset-two","openai").unwrap();
        assert_eq!(latest["slides"][0]["artworkAssetId"],"asset-one");
        assert_eq!(latest["slides"][1]["artworkAssetId"],"asset-two");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn antigravity_cli_runs_text_and_image_paths() {
        use std::os::unix::fs::PermissionsExt;
        let root=tempdir().unwrap();let bin=root.path().join("fake-agy");
        fs::write(&bin,"#!/bin/sh\ncase \"$*\" in\n  *generate_image*) cp template.png final-slide.png; printf '%s' '{\"status\":\"SUCCESS\"}' ;;\n  *) printf '%s' '{\"status\":\"SUCCESS\",\"structured_output\":{\"heading\":\"Clear heading\",\"body\":\"Useful body\",\"visualPrompt\":\"A clean portrait\"}}' ;;\nesac\n").unwrap();
        fs::set_permissions(&bin,fs::Permissions::from_mode(0o700)).unwrap();
        let state=init_state(root.path().join("workspace"),root.path().join("Downloads")).unwrap();
        let script=bin.to_string_lossy().to_string();
        let schema=text_schema("revise");let args=vec!["--output-format".to_string(),"json".to_string(),"--json-schema".to_string(),schema.to_string(),"-p".to_string(),"Return slide JSON".to_string()];
        let envelope=agy_envelope(&run_cli(&script,&args,root.path(),5).await.unwrap(),false).unwrap();
        assert_eq!(envelope["structured_output"]["heading"],"Clear heading");
        let reference=WEB.get_file("assets/design-systems/teal-editorial-pro.png").unwrap().contents();
        let old=std::env::var_os("AGY_BIN");std::env::set_var("AGY_BIN",&bin);
        let result=image_provider(&state,"antigravity","","Create a slide","image/png",reference,None,None).await;
        if let Some(value)=old{std::env::set_var("AGY_BIN",value);}else{std::env::remove_var("AGY_BIN");}
        let (mime,bytes)=result.unwrap();assert_eq!(mime,"image/png");assert_eq!(bytes,reference);
    }
}
