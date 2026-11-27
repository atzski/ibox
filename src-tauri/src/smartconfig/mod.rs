//! iBox SmartConfig — recommandation et application de réglages par jeu.
//!
//! Organisation (détail : docs/SMARTCONFIG.md) :
//! - `model`       : format interne commun (profils, paramètres typés) ;
//! - `hardware`    : détection locale et classification explicable ;
//! - `providers`   : sources externes (EmuReady), cache, quotas, hors ligne ;
//! - `validation`  : liste blanche, types, plages, contrôles matériels ;
//! - `recommend`   : moteur déterministe et explicable ;
//! - `adapters`    : un adaptateur par émulateur (Dolphin, PCSX2, DuckStation, PPSSPP,
//!   RPCS3, Azahar, RetroArch) ;
//! - `disc`        : lecture seule d'une image PS2 (identifiant PCSX2) ;
//! - `ini`, `yaml`, `cfg` : édition ciblée des fichiers de réglages (INI, YAML de RPCS3,
//!   CFG de RetroArch) ;
//! - `backup`      : écritures sûres, sauvegardes, journal, reprise ;
//! - `storage`     : accès SQLite (contexte du jeu, cache, retours) ;
//! - `commands`    : commandes Tauri ;
//! - `platform`    : système hôte (localisation Windows / Linux préparée) ;
//! - `autotune`    : fondations d'iBox AutoTune (types de mesures, aucune collecte).
//!
//! Le cœur (`model`, `validation`, `recommend`, `ini`, `backup`) ne dépend
//! d'aucune particularité de Windows ; seuls `hardware::win` et la
//! localisation des dossiers dans les adaptateurs en dépendent
//! (`platform::locate` choisit selon le système).

pub mod adapters;
pub mod android;
pub mod autotune;
pub mod backup;
pub mod cfg;
pub mod commands;
pub mod disc;
pub mod hardware;
pub mod ini;
pub mod model;
pub mod platform;
pub mod providers;
pub mod recommend;
pub mod storage;
pub mod validation;
pub mod yaml;
