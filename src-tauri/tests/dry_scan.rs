//! Essai à blanc du scanner sur un vrai dossier (lecture seule, aucune base).
//!
//! IBOX_DRY_SCAN="D:/Jeux" cargo test --test dry_scan -- --ignored --nocapture

use ibox_lib::scanner::{self, identify, walk};
use std::path::Path;

#[test]
#[ignore]
fn essai_a_blanc() {
    let Ok(root) = std::env::var("IBOX_DRY_SCAN") else {
        eprintln!("IBOX_DRY_SCAN non défini");
        return;
    };
    let (files, errors) = walk::collect(Path::new(&root), true);
    let entries = walk::group(files);
    let total = entries.len();
    let kept = scanner::accept(entries);
    println!("candidats : {total}, retenus : {}, erreurs de lecture : {}", kept.len(), errors.len());
    for e in &kept {
        let header = scanner::read_header(&e.main.path);
        // mêmes indices que le vrai scan : noms des dossiers parents
        let parents: Vec<String> = e
            .main
            .path
            .ancestors()
            .skip(1)
            .take(6)
            .filter_map(|a| a.file_name().map(|n| n.to_string_lossy().to_string()))
            .collect();
        let ctx = identify::Context {
            folder_platform: None,
            parent_dirs: parents.iter().map(String::as_str).collect(),
        };
        let id = identify::identify(&e.main.path, header.as_ref(), &ctx);
        match id {
            Some(id) => println!(
                "  {:<8} {:>4.2} {:<45} {}",
                id.platform_id,
                id.confidence,
                id.title,
                e.main.path.file_name().unwrap_or_default().to_string_lossy()
            ),
            None => println!("  (non identifié) {}", e.main.path.display()),
        }
    }
}
