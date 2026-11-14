//! Rapprochement entre la base et un nouveau scan (« Actualiser la collection »).
//!
//! Fonction pure : elle ne fait que proposer un plan. Détecte :
//! - les fichiers inchangés, réapparus ou nouveaux ;
//! - les jeux **déplacés / renommés** (même empreinte, nouveau chemin) ;
//! - les fichiers **manquants** (jamais supprimés de la base automatiquement :
//!   ils restent visibles, marqués comme introuvables) ;
//! - les **doublons** (même empreinte à plusieurs endroits).

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct KnownFile {
    pub id: i64,
    pub path: String,
    pub fingerprint: Option<String>,
    pub missing: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SeenFile {
    pub path: String,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    /// id connus retrouvés au même chemin.
    pub unchanged: Vec<i64>,
    /// id connus marqués manquants et de retour au même chemin.
    pub reappeared: Vec<i64>,
    /// (id connu, index du fichier vu) : même contenu, nouveau chemin.
    pub moved: Vec<(i64, usize)>,
    /// index des fichiers vus réellement nouveaux.
    pub added: Vec<usize>,
    /// id connus introuvables lors de ce scan.
    pub missing: Vec<i64>,
    /// groupes d'index de fichiers vus ayant la même empreinte.
    pub duplicates: Vec<Vec<usize>>,
}

/// Clé de chemin insensible à la casse et aux séparateurs (Windows).
pub fn path_key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

pub fn reconcile(known: &[KnownFile], seen: &[SeenFile]) -> Plan {
    let mut plan = Plan::default();
    let known_by_path: HashMap<String, &KnownFile> =
        known.iter().map(|k| (path_key(&k.path), k)).collect();
    let seen_keys: Vec<String> = seen.iter().map(|s| path_key(&s.path)).collect();
    let seen_set: std::collections::HashSet<&String> = seen_keys.iter().collect();

    // Connus absents de ce scan : candidats au déplacement, sinon manquants
    let mut vanished: Vec<&KnownFile> = known
        .iter()
        .filter(|k| !seen_set.contains(&path_key(&k.path)))
        .collect();

    for (i, s) in seen.iter().enumerate() {
        if let Some(k) = known_by_path.get(&seen_keys[i]) {
            if k.missing {
                plan.reappeared.push(k.id);
            } else {
                plan.unchanged.push(k.id);
            }
            continue;
        }
        let moved_from = s.fingerprint.as_ref().and_then(|fp| {
            vanished
                .iter()
                .position(|k| k.fingerprint.as_ref() == Some(fp))
        });
        match moved_from {
            Some(pos) => {
                let k = vanished.remove(pos);
                plan.moved.push((k.id, i));
            }
            None => plan.added.push(i),
        }
    }
    plan.missing = vanished
        .iter()
        .filter(|k| !k.missing)
        .map(|k| k.id)
        .collect();

    let mut by_fp: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, s) in seen.iter().enumerate() {
        if let Some(fp) = &s.fingerprint {
            by_fp.entry(fp.as_str()).or_default().push(i);
        }
    }
    let mut dups: Vec<Vec<usize>> = by_fp.into_values().filter(|v| v.len() > 1).collect();
    dups.sort();
    plan.duplicates = dups;
    plan
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(id: i64, path: &str, fp: &str, missing: bool) -> KnownFile {
        KnownFile {
            id,
            path: path.into(),
            fingerprint: Some(fp.into()),
            missing,
        }
    }
    fn s(path: &str, fp: &str) -> SeenFile {
        SeenFile {
            path: path.into(),
            fingerprint: Some(fp.into()),
        }
    }

    #[test]
    fn scenario_complet() {
        let known = vec![
            k(1, "D:/GC/Zelda.iso", "a", false), // inchangé (casse différente)
            k(2, "D:/GC/Mario.iso", "b", false), // déplacé
            k(3, "D:/GC/Metroid.iso", "c", false), // manquant
            k(4, "D:/GC/Pikmin.iso", "d", true), // réapparu
            k(5, "D:/GC/Old.iso", "e", true),    // toujours manquant : pas re-signalé
        ];
        let seen = vec![
            s("d:\\gc\\zelda.iso", "a"),
            s("D:/Archives/Mario Sunshine.iso", "b"),
            s("D:/GC/Pikmin.iso", "d"),
            s("D:/GC/F-Zero.iso", "f"),
            s("D:/Backup/F-Zero.iso", "f"),
        ];
        let plan = reconcile(&known, &seen);
        assert_eq!(plan.unchanged, vec![1]);
        assert_eq!(plan.moved, vec![(2, 1)]);
        assert_eq!(plan.reappeared, vec![4]);
        assert_eq!(plan.added, vec![3, 4]);
        assert_eq!(plan.missing, vec![3]);
        assert_eq!(plan.duplicates, vec![vec![3, 4]]);
    }

    #[test]
    fn sans_empreinte_un_fichier_renomme_est_nouveau() {
        let known = vec![KnownFile {
            id: 1,
            path: "a.iso".into(),
            fingerprint: None,
            missing: false,
        }];
        let seen = vec![SeenFile {
            path: "b.iso".into(),
            fingerprint: None,
        }];
        let plan = reconcile(&known, &seen);
        assert_eq!((plan.added, plan.missing), (vec![0], vec![1]));
    }
}
