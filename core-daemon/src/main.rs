use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashSet, VecDeque};
use std::env;
use std::fs;
use std::hash::{Hash, Hasher};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

// ============================================================================
// CYBERSPACE RENDER DISTANCE & MEMORY SAFETY CONFIGURATION
// ============================================================================
const RENDER_DEPTH_UP: i32 = 3;         // Parent levels up (..) to climb
const RENDER_DEPTH_DOWN: i32 = 3;       // Child levels down (./*) to discover from each level
const MAX_ENTRIES_PER_DIR: usize = 48;  // Max files/folders rendered per directory platform
const MAX_DIRS_PER_SCAN: usize = 65;    // Max directory platforms in bubble (prevents OOM)
const MAX_TOTAL_NODES: usize = 1800;    // Hard cap on total 3D objects sent to WebGL

#[derive(Serialize, Clone)]
struct SpatialNode {
    id: String,
    name: String,
    path: String,
    parent_path: String,
    node_type: String, // "dir", "sub_dir_portal", "file", "exec", "blackwall"
    x: f32,
    y: f32,
    z: f32,
    scale_x: f32,
    scale_y: f32,
    scale_z: f32,
    depth_rel: i32,
    seed: f32,
    matched: bool,
    visited: bool,
    marked: bool,
}

#[derive(Serialize)]
struct SpaceState {
    username: String,
    hostname: String,
    current_path: String,
    prompt_path: String,
    camera_target: [f32; 3],
    terminal_output: String,
    scan_active: bool,
    search_active: bool,
    nodes: Vec<SpatialNode>,
}

#[derive(Deserialize)]
struct ClientCommand {
    cmd: String,
    #[serde(default)]
    toggle_mark_path: Option<String>,
}

// Tracks occupied 2D rectangular footprints so directory platforms NEVER overlap
struct OccupiedRect {
    min_x: f32,
    max_x: f32,
    min_z: f32,
    max_z: f32,
}

struct RectAllocator {
    placed: Vec<OccupiedRect>,
}

impl RectAllocator {
    fn new() -> Self {
        Self { placed: Vec::new() }
    }

    fn overlaps(&self, cx: f32, cz: f32, half_w: f32, half_d: f32, margin: f32) -> bool {
        let min_x = cx - half_w - margin;
        let max_x = cx + half_w + margin;
        let min_z = cz - half_d - margin;
        let max_z = cz + half_d + margin;

        for r in &self.placed {
            if min_x < r.max_x && max_x > r.min_x && min_z < r.max_z && max_z > r.min_z {
                return true;
            }
        }
        false
    }

    // Finds a non-overlapping rectangular Manhattan grid slot near (pref_x, pref_z)
    fn allocate(&mut self, pref_x: f32, pref_z: f32, width: f32, depth: f32) -> (f32, f32) {
        let half_w = width * 0.5;
        let half_d = depth * 0.5;
        let margin = 6.0; // Clean cyber-street corridor between directory platforms
        let step = 12.0;

        if self.overlaps(pref_x, pref_z, half_w, half_d, margin) == false {
            self.placed.push(OccupiedRect {
                min_x: pref_x - half_w,
                max_x: pref_x + half_w,
                min_z: pref_z - half_d,
                max_z: pref_z + half_d,
            });
            return (pref_x, pref_z);
        }

        // Rectangular spiral search outward on an orthogonal Manhattan grid
        for ring in 1_i32..=40 {
            for dx in -ring..=ring {
                for dz in -ring..=ring {
                    if dx.abs() != ring && dz.abs() != ring {
                        continue;
                    }
                    let cx = pref_x + (dx as f32) * step;
                    let cz = pref_z + (dz as f32) * step;
                    if !self.overlaps(cx, cz, half_w, half_d, margin) {
                        self.placed.push(OccupiedRect {
                            min_x: cx - half_w,
                            max_x: cx + half_w,
                            min_z: cz - half_d,
                            max_z: cz + half_d,
                        });
                        return (cx, cz);
                    }
                }
            }
        }

        (pref_x, pref_z)
    }
}

fn hash_str(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

fn get_system_identity() -> (String, String) {
    let user = env::var("USER")
        .or_else(|_| env::var("LOGNAME"))
        .unwrap_or_else(|_| "netrunner".to_string());

    let host = fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "fortress".to_string());

    (user, host)
}

fn format_prompt_path(path: &Path) -> String {
    if let Ok(home) = env::var("HOME") {
        let p_str = path.to_string_lossy();
        if p_str == home {
            return "~".to_string();
        } else if p_str.starts_with(&format!("{}/", home)) {
            return format!("~{}", &p_str[home.len()..]);
        }
    }
    path.to_string_lossy().to_string()
}

// Deterministic orthogonal Manhattan base coordinates relative to "/" at (0,0,0)
fn get_base_dir_coords(path: &Path) -> (f32, f32, f32) {
    let mut x = 0.0;
    let mut y = 0.0;
    let mut z = 0.0;
    let mut current = PathBuf::from("/");

    for comp in path.components() {
        let comp_str = comp.as_os_str().to_string_lossy();
        if comp_str == "/" {
            continue;
        }
        current.push(comp_str.as_ref());
        let h = hash_str(&current.to_string_lossy());
        // Orthogonal grid offsets instead of circular angles
        let grid_x = ((h % 7) as i32 - 3) as f32 * 22.0;
        let grid_z = (((h / 7) % 7) as i32 - 3) as f32 * 22.0;
        x += if grid_x == 0.0 && grid_z == 0.0 { 22.0 } else { grid_x };
        z += grid_z;
        y -= 14.0;
    }
    (x, y, z)
}

// Skip Linux virtual pseudo-filesystems during automatic multi-level recursion
fn is_virtual_fs(path: &Path) -> bool {
    path == Path::new("/proc")
        || path == Path::new("/sys")
        || path == Path::new("/dev")
        || path == Path::new("/run")
}

struct FileItem {
    name: String,
    path_str: String,
    node_type: String,
    sx: f32,
    sy: f32,
    sz: f32,
    seed: f32,
    matched: bool,
    visited: bool,
    marked: bool,
}

#[allow(clippy::too_many_arguments)]
fn build_single_directory_platform(
    dir_path: &Path,
    depth_rel: i32,
    will_expand_children: &HashSet<PathBuf>,
    search_filter: &Option<String>,
    visited_set: &HashSet<String>,
    marked_set: &HashSet<String>,
    allocator: &mut RectAllocator,
    nodes: &mut Vec<SpatialNode>,
) -> (f32, f32, f32) {
    let (base_x, base_y, base_z) = get_base_dir_coords(dir_path);
    let dir_path_str = dir_path.to_string_lossy().to_string();
    let parent_path_str = dir_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let dir_name = dir_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());

    let is_dir_visited = visited_set.contains(&dir_path_str);
    let is_dir_marked = marked_set.contains(&dir_path_str);

    let read_res = fs::read_dir(dir_path);
    if read_res.is_err() {
        let (cx, cz) = allocator.allocate(base_x, base_z, 12.0, 4.0);
        nodes.push(SpatialNode {
            id: dir_path_str.clone(),
            name: format!("[BLACKWALL: {}]", dir_name),
            path: dir_path_str,
            parent_path: parent_path_str,
            node_type: "blackwall".to_string(),
            x: cx,
            y: base_y + 6.0,
            z: cz,
            scale_x: 10.0,
            scale_y: 14.0,
            scale_z: 2.0,
            depth_rel,
            seed: (hash_str(&dir_name) % 1000) as f32 / 1000.0,
            matched: false,
            visited: is_dir_visited,
            marked: is_dir_marked,
        });
        return (cx, base_y, cz);
    }

    let mut entries: Vec<_> = read_res.unwrap().filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name().to_string_lossy().starts_with('.'));
        entries.truncate(MAX_ENTRIES_PER_DIR);

    let mut items: Vec<FileItem> = Vec::new();
    let mut max_w: f32 = 1.6;
    let mut max_d: f32 = 1.6;

    for entry in entries {
        if nodes.len() + items.len() >= MAX_TOTAL_NODES {
            break;
        }
        let path = entry.path();
        // If this subdirectory is being expanded into its own full platform, don't duplicate it as a small block
        if path.is_dir() && will_expand_children.contains(&path) {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        let name = entry.file_name().to_string_lossy().to_string();
        let h = hash_str(&path_str);
        let seed = (h % 1000) as f32 / 1000.0;

        let metadata = fs::symlink_metadata(&path);
        let (node_type, sx, sy, sz) = match metadata {
            Ok(meta) => {
                // Rectangular dimensions scaled by actual file byte size
                let size_factor = (meta.len() as f32 / 1024.0).ln_1p();
                let w = 1.2 + (size_factor * 0.22).clamp(0.0, 2.4);
                let d = 1.2 + (size_factor * 0.16).clamp(0.0, 2.0);
                let height = 1.0 + (size_factor * 0.85).clamp(0.2, 9.5);

                if meta.is_dir() {
                    if fs::read_dir(&path).is_err() {
                        ("blackwall".to_string(), 4.5, 9.0, 1.5)
                    } else {
                        ("sub_dir_portal".to_string(), 2.6, 2.8, 2.6)
                    }
                } else if meta.permissions().mode() & 0o111 != 0 {
                    ("exec".to_string(), w, height, d)
                } else {
                    ("file".to_string(), w, height, d)
                }
            }
            Err(_) => ("blackwall".to_string(), 4.5, 9.0, 1.5),
        };

        let node_type = if name.starts_with('.') && node_type != "blackwall" {
            "hidden".to_string()
        } else {
            node_type
        };

        max_w = max_w.max(sx);
        max_d = max_d.max(sz);

        let matched = if let Some(ref query) = search_filter {
            name.to_lowercase().contains(&query.to_lowercase())
        } else {
            false
        };

        items.push(FileItem {
            name,
            path_str: path_str.clone(),
            node_type,
            sx,
            sy,
            sz,
            seed,
            matched,
            visited: visited_set.contains(&path_str),
            marked: marked_set.contains(&path_str),
        });
    }

    // Calculate Rectangular Grid & Dynamic Platform Size based on file count & file dimensions
    let count = items.len();
    let cols = (count as f32).sqrt().ceil() as usize;
    let rows = if cols > 0 { (count + cols - 1) / cols } else { 0 };

    // Guaranteed corridor gap (1.8 units) between cells so files NEVER intersect
    let cell_w = max_w + 1.8;
    let cell_d = max_d + 1.8;

    let plat_w = ((cols as f32) * cell_w + 5.0).max(8.0);
    let plat_d = ((rows as f32) * cell_d + 5.0).max(8.0);

    // Allocate non-overlapping rectangular coordinates for this platform
    let (cx, cz) = allocator.allocate(base_x, base_z, plat_w, plat_d);

    // Push Dynamic Rectangular Directory Platform
    nodes.push(SpatialNode {
        id: dir_path_str.clone(),
        name: dir_name,
        path: dir_path_str.clone(),
        parent_path: parent_path_str,
        node_type: "dir".to_string(),
        x: cx,
        y: base_y - 0.3,
        z: cz,
        scale_x: plat_w,
        scale_y: 0.5,
        scale_z: plat_d,
        depth_rel,
        seed: 0.1,
        matched: false,
        visited: is_dir_visited,
        marked: is_dir_marked,
    });

    // Place each file in its dedicated non-overlapping rectangular cell on the platform
    let start_x = cx - ((cols.saturating_sub(1) as f32) * cell_w) * 0.5;
    let start_z = cz - ((rows.saturating_sub(1) as f32) * cell_d) * 0.5;

    for (idx, item) in items.into_iter().enumerate() {
        let col = idx % cols.max(1);
        let row = idx / cols.max(1);

        let fx = start_x + (col as f32) * cell_w;
        let fz = start_z + (row as f32) * cell_d;
        let lift = if item.matched { 5.5 } else { 0.0 };
        let fy = base_y + item.sy * 0.5 + lift;

        nodes.push(SpatialNode {
            id: item.path_str.clone(),
            name: item.name,
            path: item.path_str,
            parent_path: dir_path_str.clone(),
            node_type: item.node_type,
            x: fx,
            y: fy,
            z: fz,
            scale_x: item.sx,
            scale_y: item.sy,
            scale_z: item.sz,
            depth_rel,
            seed: item.seed,
            matched: item.matched,
            visited: item.visited,
            marked: item.marked,
        });
    }

    (cx, base_y, cz)
}

#[allow(clippy::too_many_arguments)]
fn build_state(
    username: &str,
    hostname: &str,
    current_dir: &Path,
    msg: String,
    scan_active: bool,
    search_filter: Option<String>,
    visited_set: &HashSet<String>,
    marked_set: &HashSet<String>,
) -> SpaceState {
    // 1. Discover directory graph:
    //    Start at current_dir (up = 0) -> go down RENDER_DEPTH_DOWN.
    //    Then climb up 1..=RENDER_DEPTH_UP (stopping at "/"), and from each ancestor go down RENDER_DEPTH_DOWN,
    //    always excluding any directory path already discovered!
    let mut discovered_dirs: Vec<(PathBuf, i32)> = Vec::new();
    let mut seen_dirs: HashSet<PathBuf> = HashSet::new();

    let mut ancestor_chain: Vec<(PathBuf, i32)> = Vec::new();
    let mut cursor = Some(current_dir.to_path_buf());

    for up_step in 0..=RENDER_DEPTH_UP {
        if let Some(dir) = cursor {
            ancestor_chain.push((dir.clone(), -up_step));
            // Stop climbing if we hit root "/"
            if dir == Path::new("/") {
                break;
            }
            cursor = dir.parent().map(|p| p.to_path_buf());
        } else {
            break;
        }
    }

    // For each level up, BFS down up to RENDER_DEPTH_DOWN levels
    for (start_dir, base_rel_depth) in ancestor_chain {
        let mut queue: VecDeque<(PathBuf, i32)> = VecDeque::new();

        if !seen_dirs.contains(&start_dir) {
            seen_dirs.insert(start_dir.clone());
            queue.push_back((start_dir, 0));
        } else {
            // Even if start_dir was seen, we still want to explore its unvisited children
            queue.push_back((start_dir, 0));
        }

        while let Some((curr_path, down_step)) = queue.pop_front() {
            if discovered_dirs.len() >= MAX_DIRS_PER_SCAN {
                break;
            }

            let rel_depth = if base_rel_depth == 0 {
                down_step
            } else {
                base_rel_depth
            };

            if !discovered_dirs.iter().any(|(p, _)| p == &curr_path) {
                discovered_dirs.push((curr_path.clone(), rel_depth));
            }

            // Stop discovering further down if we reached RENDER_DEPTH_DOWN
            if down_step >= RENDER_DEPTH_DOWN {
                continue;
            }

            // Do not auto-recurse deep into /proc, /sys, /dev unless user is directly inside them
            if curr_path != current_dir && is_virtual_fs(&curr_path) {
                continue;
            }

            if let Ok(rd) = fs::read_dir(&curr_path) {
                for entry in rd.filter_map(|e| e.ok()).take(MAX_ENTRIES_PER_DIR) {
                    if seen_dirs.len() >= MAX_DIRS_PER_SCAN {
                        break;
                    }
                    let is_hidden = entry.file_name().to_string_lossy().starts_with('.');
                    // Only auto-follow non-hidden real directories so .cache/.git don't eat the node budget
                    if let Ok(ft) = entry.file_type() {
                        if ft.is_dir() && !ft.is_symlink() && !is_hidden {
                            let next_path = entry.path();
                            if !seen_dirs.contains(&next_path) {
                                seen_dirs.insert(next_path.clone());
                                queue.push_back((next_path, down_step + 1));
                            }
                        }
                    }
                }
            }
        }
    }

    let expanded_set: HashSet<PathBuf> = discovered_dirs.iter().map(|(p, _)| p.clone()).collect();
    let mut allocator = RectAllocator::new();
    let mut nodes = Vec::new();
    let mut current_cam_target = [0.0, 0.0, 0.0];

    for (dir_path, depth_rel) in &discovered_dirs {
        if nodes.len() >= MAX_TOTAL_NODES {
            break;
        }
        let (cx, cy, cz) = build_single_directory_platform(
            dir_path,
            *depth_rel,
            &expanded_set,
            &search_filter,
            visited_set,
            marked_set,
            &mut allocator,
            &mut nodes,
        );
        if dir_path == current_dir {
            current_cam_target = [cx, cy, cz];
        }
    }

    SpaceState {
        username: username.to_string(),
        hostname: hostname.to_string(),
        current_path: current_dir.to_string_lossy().to_string(),
        prompt_path: format_prompt_path(current_dir),
        camera_target: current_cam_target,
        terminal_output: msg,
        scan_active,
        search_active: search_filter.is_some(),
        nodes,
    }
}

#[tokio::main]
async fn main() {
    let addr = "127.0.0.1:9001";
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind port 9001");
    let (username, hostname) = get_system_identity();

    println!("⚡ CYBERSPACE CORE DAEMON ONLINE: ws://{}", addr);
    println!(
        "   Identity: {}@{} | Depth Up: {} | Depth Down: {}",
        username, hostname, RENDER_DEPTH_UP, RENDER_DEPTH_DOWN
    );

    while let Ok((stream, _)) = listener.accept().await {
        let user_clone = username.clone();
        let host_clone = hostname.clone();

        tokio::spawn(async move {
            let ws_stream = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(_) => return,
            };
            let (mut write, mut read) = ws_stream.split();

            let mut current_dir = env::var("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/"));

            let mut visited_set: HashSet<String> = HashSet::new();
            let mut marked_set: HashSet<String> = HashSet::new();
            visited_set.insert(current_dir.to_string_lossy().to_string());

            let init_state = build_state(
                &user_clone,
                &host_clone,
                &current_dir,
                format!(
                    "Connected to Datafortress ({}@{}). Render Bubble: Up {} / Down {}.",
                    user_clone, host_clone, RENDER_DEPTH_UP, RENDER_DEPTH_DOWN
                ),
                false,
                None,
                &visited_set,
                &marked_set,
            );
            let _ = write
                .send(Message::Text(serde_json::to_string(&init_state).unwrap().into()))
                .await;

            while let Some(Ok(Message::Text(text))) = read.next().await {
                if let Ok(client_cmd) = serde_json::from_str::<ClientCommand>(text.as_str()) {
                    if let Some(mark_path) = client_cmd.toggle_mark_path {
                        let msg = if marked_set.contains(&mark_path) {
                            marked_set.remove(&mark_path);
                            format!("Removed beacon mark from {}", mark_path)
                        } else {
                            marked_set.insert(mark_path.clone());
                            format!("Beacon mark locked onto {}", mark_path)
                        };
                        let state = build_state(
                            &user_clone,
                            &host_clone,
                            &current_dir,
                            msg,
                            false,
                            None,
                            &visited_set,
                            &marked_set,
                        );
                        let _ = write
                            .send(Message::Text(serde_json::to_string(&state).unwrap().into()))
                            .await;
                        continue;
                    }

                    let raw_cmd = client_cmd.cmd.trim();
                    if raw_cmd.is_empty() {
                        continue;
                    }
                    let parts: Vec<&str> = raw_cmd.split_whitespace().collect();

                    let mut output: String;
                    let mut scan_active = false;
                    let mut search_filter = None;

                    match parts[0] {
                        "cd" => {
                            let target = raw_cmd.strip_prefix("cd").unwrap_or("").trim().trim_matches('"');
                            let target = if target.is_empty() { "~" } else { target };
                            let new_path = if target == "~" {
                                env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
                            } else if target.starts_with('/') {
                                PathBuf::from(target)
                            } else {
                                current_dir.join(target)
                            };

                            match fs::canonicalize(&new_path) {
                                Ok(canon) => {
                                    if fs::read_dir(&canon).is_ok() {
                                        current_dir = canon;
                                        visited_set.insert(current_dir.to_string_lossy().to_string());
                                        output = format!("Warped to sector {}", current_dir.display());
                                    } else {
                                        output = format!(
                                            "ERROR [EACCES]: Blackwall repulsed entry to {}",
                                            canon.display()
                                        );
                                    }
                                }
                                Err(e) => output = format!("cd: {}", e),
                            }
                        }
                        "find" | "search" => {
                            if let Some(pattern) = parts.get(1) {
                                let clean = pattern.replace('*', "");
                                search_filter = Some(clean.clone());
                                scan_active = true;
                                output = format!("Bending space for query '*{}*'...", clean);
                            } else {
                                output = "Usage: find <pattern> (e.g., find .log)".to_string();
                            }
                        }
                        "mark" => {
                            if let Some(target) = parts.get(1) {
                                let target_path = current_dir.join(target);
                                let key = fs::canonicalize(&target_path)
                                    .unwrap_or(target_path)
                                    .to_string_lossy()
                                    .to_string();
                                if marked_set.contains(&key) {
                                    marked_set.remove(&key);
                                    output = format!("Unmarked: {}", key);
                                } else {
                                    marked_set.insert(key.clone());
                                    output = format!("Marked location: {}", key);
                                }
                            } else {
                                output = "Usage: mark <filename_or_dir> (or Ctrl+Click any node in 3D/2D)".to_string();
                            }
                        }
                        "scan" => {
                            scan_active = true;
                            output = format!("Active telemetry pulse in {}", current_dir.display());
                        }
                        _ => {
                            match Command::new("bash")
                                .arg("-c")
                                .arg(raw_cmd)
                                .current_dir(&current_dir)
                                .output()
                                .await
                            {
                                Ok(res) => {
                                    let stdout = String::from_utf8_lossy(&res.stdout);
                                    let stderr = String::from_utf8_lossy(&res.stderr);
                                    output = format!("{}{}", stdout, stderr).trim_end().to_string();
                                    if output.is_empty() {
                                        output = "[Command completed with exit code 0]".to_string();
                                    }
                                }
                                Err(e) => {
                                    output = format!("Shell execution error: {}", e);
                                }
                            }
                        }
                    }

                    let state = build_state(
                        &user_clone,
                        &host_clone,
                        &current_dir,
                        output,
                        scan_active,
                        search_filter,
                        &visited_set,
                        &marked_set,
                    );
                    let _ = write
                        .send(Message::Text(serde_json::to_string(&state).unwrap().into()))
                        .await;
                }
            }
        });
    }
}