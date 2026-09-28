use crate::providers::{self, Job, Paths};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::AtomicUsize,
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Config {
    pub origin: String,
    pub token: String,
    pub id: String,
    #[serde(default)]
    pub paths: Paths,
}
#[derive(Clone, Serialize)]
pub struct Status {
    pub paired: bool,
    pub origin: String,
    pub running: bool,
    pub busy: bool,
    pub message: String,
    pub capabilities: Value,
    pub paths: Paths,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            paired: false,
            origin: String::new(),
            running: false,
            busy: false,
            message: "Pair with your Smilecraft workspace to begin.".into(),
            capabilities: json!({}),
            paths: Paths::default(),
        }
    }
}
pub struct Engine {
    pub config: Mutex<Option<Config>>,
    pub status: Mutex<Status>,
    pub cancel: AtomicBool,
    pub shutdown: AtomicBool,
    pub worker_busy: AtomicBool,
    pub active_codex: AtomicUsize,
    pub active_antigravity: AtomicUsize,
    pub refresh: AtomicBool,
    pub operation: Mutex<()>,
    client: reqwest::blocking::Client,
}
pub fn validate_origin(raw: &str) -> Result<String, String> {
    let u = url::Url::parse(raw.trim()).map_err(|_| "Enter a valid Smilecraft website URL")?;
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.path() != "/"
        || (u.scheme() != "https"
            && !(u.scheme() == "http"
                && matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))))
    {
        return Err("Use an HTTPS website origin, or HTTP localhost for development.".into());
    }
    Ok(u.origin().ascii_serialization())
}
fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.smilecraft.companion", "device")
        .map_err(|_| "Cannot access the system credential store".into())
}
pub fn save(config: &Config) -> Result<(), String> {
    credential()?
        .set_password(&serde_json::to_string(config).unwrap())
        .map_err(|_| "Cannot save pairing in the system credential store".into())
}
pub fn load() -> Result<Option<Config>, String> {
    match credential()?.get_password() {
        Ok(s) => {
            let mut c: Config =
                serde_json::from_str(&s).map_err(|_| "Saved pairing is invalid. Pair again.")?;
            c.origin = validate_origin(&c.origin)?;
            Ok(Some(c))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => {
            Err("Cannot unlock the saved pairing. Check your system credential store.".into())
        }
    }
}
#[derive(Debug)]
pub struct ApiError {
    pub code: u16,
    pub message: String,
}
impl Engine {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            config: Mutex::new(None),
            status: Mutex::new(Status::default()),
            cancel: AtomicBool::new(true),
            shutdown: AtomicBool::new(false),
            worker_busy: AtomicBool::new(false),
            active_codex: AtomicUsize::new(0),
            active_antigravity: AtomicUsize::new(0),
            refresh: AtomicBool::new(true),
            operation: Mutex::new(()),
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
        })
    }
    pub fn message(&self, s: &str) {
        self.status.lock().unwrap().message = s.into();
    }
    pub fn request(&self, c: &Config, path: &str, body: Value) -> Result<Value, ApiError> {
        let mut req = self
            .client
            .post(format!("{}/api/companion{path}", c.origin))
            .json(&body);
        if path.ends_with("/references")
            || (path.ends_with("/complete") && body["result"]["image"].is_string())
        {
            req = req.timeout(Duration::from_secs(60));
        }
        if !c.token.is_empty() {
            req = req.bearer_auth(&c.token);
        }
        let response = req.send().map_err(|_| ApiError {
            code: 0,
            message: "Cannot reach Smilecraft. Check your connection and website URL.".into(),
        })?;
        let code = response.status().as_u16();
        if !response.status().is_success() {
            return Err(ApiError {
                code,
                message: match code {
                    401 => "Device access revoked. Pair again.",
                    400 => "Pairing code expired or request invalid.",
                    409 => "Job is no longer active.",
                    _ => "Smilecraft request failed. Retrying shortly.",
                }
                .into(),
            });
        }
        use std::io::Read;
        let mut bytes = Vec::new();
        let limit = if path.ends_with("/references") {
            22_000_000
        } else {
            65536
        };
        response
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError {
                code: 0,
                message: "Incomplete response".into(),
            })?;
        if bytes.len() > limit as usize {
            return Err(ApiError {
                code: 0,
                message: "Response exceeds size limit".into(),
            });
        }
        serde_json::from_slice(&bytes).map_err(|_| ApiError {
            code: 0,
            message: "Invalid Smilecraft response".into(),
        })
    }
    pub fn pause(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        self.status.lock().unwrap().running = false;
        self.message("Paused. Active generation is being stopped.");
    }
    pub fn start(&self) -> Result<(), String> {
        let _operation = self.operation.lock().unwrap();
        if self.config.lock().unwrap().is_none() {
            return Err("Pair with Smilecraft first".into());
        }
        if self.worker_busy.load(Ordering::SeqCst) {
            return Err("Wait for the previous task to stop".into());
        }
        self.cancel.store(false, Ordering::SeqCst);
        self.status.lock().unwrap().running = true;
        self.message("Connecting…");
        Ok(())
    }
    fn sleep(&self, ms: u64) {
        for _ in 0..ms / 100 {
            if self.cancel.load(Ordering::SeqCst) || self.shutdown.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
    pub fn worker(self: Arc<Self>) {
        let mut checked = 0;
        while !self.shutdown.load(Ordering::SeqCst) {
            if self.cancel.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            self.worker_busy.store(true, Ordering::SeqCst);
            let c = self.config.lock().unwrap().clone();
            if let Some(c) = c {
                if now() - checked > 60000 || self.refresh.swap(false, Ordering::SeqCst) {
                    self.message("Checking installed AI providers…");
                    let caps = providers::inspect(&c.paths, &self.cancel);
                    self.status.lock().unwrap().capabilities = caps;
                    checked = now();
                }
                if !self.cancel.load(Ordering::SeqCst) {
                    let mut caps = self.status.lock().unwrap().capabilities.clone();
                    if self.active_codex.load(Ordering::SeqCst) >= 5 {
                        caps["codex"]["ready"] = json!(false);
                    }
                    if self.active_antigravity.load(Ordering::SeqCst) >= 5 {
                        caps["antigravity"]["ready"] = json!(false);
                    }
                    match self.request(&c, "/poll", caps) {
                        Ok(v) => {
                            if v["job"].is_null() {
                                self.message("Connected · waiting for a generation request");
                            } else {
                                match serde_json::from_value::<Job>(v["job"].clone()) {
                                    Ok(job) => {
                                        let counter = if job.provider == "codex" {
                                            &self.active_codex
                                        } else {
                                            &self.active_antigravity
                                        };
                                        counter.fetch_add(1, Ordering::SeqCst);
                                        self.status.lock().unwrap().busy = true;
                                        let is_codex = job.provider == "codex";
                                        let engine = self.clone();
                                        let config = c.clone();
                                        thread::spawn(move || {
                                            engine.execute(&config, job);
                                            let counter = if is_codex {
                                                &engine.active_codex
                                            } else {
                                                &engine.active_antigravity
                                            };
                                            counter.fetch_sub(1, Ordering::SeqCst);
                                            let busy = engine.active_codex.load(Ordering::SeqCst)
                                                + engine.active_antigravity.load(Ordering::SeqCst)
                                                > 0;
                                            engine.status.lock().unwrap().busy = busy;
                                            engine.worker_busy.store(busy, Ordering::SeqCst);
                                        });
                                    }
                                    Err(_) => {
                                        self.message("Rejected an invalid job; it will expire.")
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            self.message(&e.message);
                            if e.code == 401 {
                                self.cancel.store(true, Ordering::SeqCst);
                                self.status.lock().unwrap().running = false;
                            } else {
                                self.sleep(5000);
                            }
                        }
                    }
                }
            }
            self.worker_busy.store(
                self.active_codex.load(Ordering::SeqCst)
                    + self.active_antigravity.load(Ordering::SeqCst)
                    > 0,
                Ordering::SeqCst,
            );
            self.sleep(500);
        }
    }
    fn execute(&self, c: &Config, job: Job) {
        self.status.lock().unwrap().busy = true;
        self.message(&format!("{} · generating {}", job.provider, job.task));
        let done = AtomicBool::new(false);
        let lost = AtomicBool::new(false);
        let job_cancel = AtomicBool::new(self.cancel.load(Ordering::SeqCst));
        let result = thread::scope(|scope| {
            scope.spawn(|| {
                let mut ticks = 0;
                while !done.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(100));
                    if self.cancel.load(Ordering::SeqCst) || self.shutdown.load(Ordering::SeqCst) {
                        job_cancel.store(true, Ordering::SeqCst);
                        break;
                    }
                    ticks += 1;
                    if ticks >= 10 {
                        ticks = 0;
                        match self.request(
                            c,
                            &format!("/jobs/{}/heartbeat", job.id),
                            json!({"lease":job.lease}),
                        ) {
                            Ok(v) if v["active"] == true => {}
                            _ => {
                                lost.store(true, Ordering::SeqCst);
                                job_cancel.store(true, Ordering::SeqCst);
                                break;
                            }
                        }
                    }
                }
            });
            let r = if job.task == "image" {
                self.request(
                    c,
                    &format!("/jobs/{}/references", job.id),
                    json!({"lease":job.lease}),
                )
                .map_err(|e| e.message)
                .and_then(|refs| providers::generate_image(&job, &c.paths, &refs, &job_cancel))
            } else {
                providers::generate(&job, &c.paths, &job_cancel)
            };
            done.store(true, Ordering::SeqCst);
            r
        });
        let body = match result {
            Ok(v) => json!({"lease":job.lease,"result":v}),
            Err(_) => {
                json!({"lease":job.lease,"error":if job_cancel.load(Ordering::SeqCst) {"cancelled"} else {"generation_failed"}})
            }
        };
        let mut delivered = false;
        for attempt in 0..3 {
            match self.request(c, &format!("/jobs/{}/complete", job.id), body.clone()) {
                Ok(_) => {
                    delivered = true;
                    break;
                }
                Err(e) => {
                    self.message(&e.message);
                    if e.code == 401 || e.code == 409 {
                        break;
                    }
                    self.sleep(1000 * (1 << attempt));
                }
            }
        }
        if lost.load(Ordering::SeqCst) {
            self.message("Job stopped or lease lost. Other jobs can continue.");
        } else if delivered {
            self.message(if body.get("error").is_some() {
                "Generation failed. Check CLI sign-in and model access."
            } else {
                "Result delivered to Smilecraft."
            });
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_origins() {
        assert_eq!(
            validate_origin("https://example.com/").unwrap(),
            "https://example.com"
        );
        assert!(validate_origin("http://localhost:8787").is_ok());
        for v in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/path",
            "https://example.com?token=secret",
            "file:///tmp",
        ] {
            assert!(validate_origin(v).is_err());
        }
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use std::io::{Read, Write};
    fn server(status: &str, body: &str, extra: &str) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
            body.len()
        );
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut data = [0; 8192];
            let n = stream.read(&mut data).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&data[..n]).into_owned()
        });
        (address, handle)
    }
    fn config(origin: String) -> Config {
        Config {
            origin,
            token: "test-device-token".into(),
            id: "test".into(),
            paths: Paths::default(),
        }
    }
    #[test]
    fn bearer_and_poll_contract() {
        let (origin, handle) = server(
            "200 OK",
            r#"{"job":null}"#,
            "Content-Type: application/json\r\n",
        );
        let result = Engine::new()
            .request(&config(origin), "/poll", json!({}))
            .unwrap();
        assert!(result["job"].is_null());
        let request = handle.join().unwrap();
        assert!(request.starts_with("POST /api/companion/poll "));
        assert!(request
            .to_lowercase()
            .contains("authorization: bearer test-device-token"));
    }
    #[test]
    fn refuses_redirect_and_redacts_errors() {
        for (status, code) in [("302 Found", 302), ("401 Unauthorized", 401)] {
            let (origin, handle) = server(
                status,
                "sensitive-provider-error",
                "Location: https://example.com/steal\r\n",
            );
            let error = Engine::new()
                .request(&config(origin), "/poll", json!({}))
                .unwrap_err();
            assert_eq!(error.code, code);
            assert!(!error.message.contains("sensitive"));
            handle.join().unwrap();
        }
    }
}
