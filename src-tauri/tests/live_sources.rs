//! Tests contre les vrais services (réseau). Exclus des tests normaux :
//! `cargo test --test live_sources -- --ignored --nocapture`

use ibox_lib::db;
use ibox_lib::metadata::{gametdb, http::Http, libretro_meta, libretro_thumbs, matching, media::MediaStore, MediaKind};
use ibox_lib::scanner::Region;

#[test]
#[ignore]
fn libretro_index_et_image_reelle() {
    let http = Http::new().unwrap();
    let conn = db::open_in_memory().unwrap();
    let n = libretro_thumbs::ensure_index(&http, &conn, "gamecube", MediaKind::Front, false).unwrap();
    println!("index GameCube : {n} jaquettes");
    assert!(n > 500);

    let names = libretro_thumbs::names(&conn, "gamecube", MediaKind::Front).unwrap();
    let decision = matching::decide("Pikmin (Europe) (En,Fr,De,Es,It)", "Pikmin", Region::Pal, &names);
    println!("décision : {decision:?}");
    let matching::Decision::Auto { name, .. } = decision else { panic!("Pikmin devrait être trouvé") };

    let url = libretro_thumbs::url("gamecube", MediaKind::Front, &name).unwrap();
    let bytes = ibox_lib::metadata::job::download_image(&http, &url).unwrap();
    println!("{url} → {} octets", bytes.len());

    conn.execute(
        "INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (1, 'gamecube', 'Pikmin', 'pikmin', 'x', 'header', 1)",
        [],
    )
    .unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let row = MediaStore::new(tmp.path().to_path_buf()).save(&conn, 1, MediaKind::Front, 0, &bytes, "libretro", Some(&url)).unwrap();
    println!("image validée : {:?}×{:?}", row.width, row.height);
}

#[test]
#[ignore]
fn base_gametdb_reelle() {
    let http = Http::new().unwrap();
    let conn = db::open_in_memory().unwrap();
    let n = gametdb::ensure(&http, &conn, "wii", false).unwrap();
    println!("GameTDB Wii/GameCube : {n} jeux");
    let pikmin = gametdb::lookup(&conn, "gamecube", "GPIP01").unwrap().expect("GPIP01");
    println!("{:?}", pikmin);
    assert_eq!(pikmin.platform_id, "gamecube");
    assert!(pikmin.title().is_some());
    let gc: i64 = conn.query_row("SELECT count(*) FROM ref_gametdb WHERE platform_id = 'gamecube'", [], |r| r.get(0)).unwrap();
    println!("dont GameCube : {gc}");
    assert!(gc > 1000);
}

#[test]
#[ignore]
fn libretro_database_reelle() {
    let http = Http::new().unwrap();
    let conn = db::open_in_memory().unwrap();
    let n = libretro_meta::ensure(&http, &conn, "gba", false).unwrap();
    println!("libretro-database GBA : {n} entrées");
    assert!(n > 1000);
    let e = libretro_meta::lookup(&conn, "gba", None, "x", "Advance Wars").unwrap().expect("Advance Wars");
    println!("{e:?}");
    assert!(e.year.is_some() || e.developer.is_some());
}
