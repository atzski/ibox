//! Remote Play, Phase 3 (côté natif) : exécution des entrées distantes sur l'hôte.
//!
//! Chaîne : message décodé (`protocol`) → [`Engine::handle`] → `permissions::Session::authorize`
//! (refus par défaut, plafond du mode, arrêt d'urgence) → [`Injector`] → `SendInput` / ViGEmBus.
//! Chaque retrait de droit, départ, blocage ou arrêt d'urgence exécute les relâchements calculés
//! par la session. Détails et limites : `docs/REMOTE-PLAY.md` §9.

pub mod geometry;
pub mod hotkey;
pub mod inject;
pub mod local;
pub mod pads;
#[cfg(windows)]
pub mod win;

#[cfg(windows)]
use std::sync::{Arc, Mutex};

use super::permissions::{Denied, Grants, ParticipantId, Profile, Session};
use super::protocol::{Message, PadState};
pub use hotkey::{Hotkey, StopReason};
pub use inject::{Area, InjectError, Injector, OsInput, Outcome, Screen, Sink};
pub use local::LocalActivity;
pub use pads::{NoPads, PadError, Pads, RetryPads, RumbleFn, GUEST_PAD_WAITING};

/// Résultat de l'exécution d'une action autorisée.
pub type Done = Result<Outcome, InjectError>;

impl Pads for Box<dyn Pads> {
    fn update(&mut self, pad: u8, state: &PadState) -> Result<(), PadError> {
        (**self).update(pad, state)
    }
}

/// Session de permissions + injecteur : rien n'est injecté sans autorisation, et tout ce que la
/// session demande de relâcher est réellement relâché.
pub struct Engine<S, D, P> {
    session: Session,
    injector: Injector<S, D, P>,
    stopped: Option<StopReason>,
}

impl<S: Sink, D: Screen, P: Pads> Engine<S, D, P> {
    pub fn new(session: Session, injector: Injector<S, D, P>) -> Self {
        Engine { session, injector, stopped: None }
    }

    pub fn session(&self) -> &Session {
        &self.session
    }

    pub fn injector(&self) -> &Injector<S, D, P> {
        &self.injector
    }

    pub fn set_area(&mut self, area: Area) {
        self.injector.set_area(area);
    }

    fn run(&mut self, actions: Vec<Message>) -> Vec<Done> {
        // chaque action est tentée, même si une précédente échoue : un relâchement ne doit jamais être sauté
        actions.iter().map(|m| self.injector.execute(m)).collect()
    }

    pub fn join(&mut self, id: ParticipantId, account: &str) -> Result<(), Denied> {
        self.session.join(id, account)
    }

    /// Message reçu d'un participant : autorisé puis exécuté, ou refusé sans aucun effet.
    pub fn handle(&mut self, id: ParticipantId, msg: Message) -> Result<Vec<Done>, Denied> {
        let actions = self.session.authorize(id, msg)?;
        Ok(self.run(actions))
    }

    pub fn set_profile(&mut self, id: ParticipantId, profile: Profile, risks_acknowledged: bool) -> Result<Vec<Done>, Denied> {
        let actions = self.session.set_profile(id, profile, risks_acknowledged)?;
        Ok(self.run(actions))
    }

    pub fn set_grants(&mut self, id: ParticipantId, grants: Grants) -> Result<Vec<Done>, Denied> {
        let actions = self.session.set_grants(id, grants)?;
        Ok(self.run(actions))
    }

    pub fn assign_pad(&mut self, id: ParticipantId, pad: Option<u8>) -> Result<Vec<Done>, Denied> {
        let actions = self.session.assign_pad(id, pad)?;
        Ok(self.run(actions))
    }

    pub fn enable_pad(&mut self, id: ParticipantId, enabled: bool) -> Result<Vec<Done>, Denied> {
        let actions = self.session.enable_pad(id, enabled)?;
        Ok(self.run(actions))
    }

    /// Déconnexion (volontaire ou non) : tout ce que le participant tenait est relâché.
    pub fn leave(&mut self, id: ParticipantId) -> Vec<Done> {
        let actions = self.session.leave(id);
        self.run(actions)
    }

    pub fn block(&mut self, id: ParticipantId) -> Vec<Done> {
        let actions = self.session.block(id);
        self.run(actions)
    }

    /// Arrêt d'urgence : plus aucune entrée distante jusqu'à [`Engine::resume`], tout est relâché.
    pub fn emergency_stop(&mut self, reason: StopReason) -> Vec<Done> {
        self.stopped = Some(reason);
        let actions = self.session.suspend();
        self.run(actions)
    }

    /// Reprise décidée par l'hôte (jamais automatique, même au déverrouillage).
    pub fn resume(&mut self) {
        self.stopped = None;
        self.session.resume();
    }

    pub fn stop_reason(&self) -> Option<StopReason> {
        self.stopped
    }
}

/// Moteur réel de l'hôte.
#[cfg(windows)]
pub type HostEngine = Engine<win::WinSink, win::WinScreen, Box<dyn Pads>>;

/// Manettes virtuelles ViGEmBus, connectées au premier état reçu et rebranchées d'elles-mêmes
/// dès que le pilote est installé (même en cours de session).
#[cfg(windows)]
pub fn host_pads(on_rumble: RumbleFn) -> Box<dyn Pads> {
    Box::new(pads::RetryPads::new(Box::new(move || {
        pads::VigemPads::connect(on_rumble.clone()).map(|p| Box::new(p) as Box<dyn Pads>)
    })))
}

/// Démarre le fil de garde pour `engine` : raccourci d'arrêt d'urgence, verrouillage et
/// changement de session déclenchent [`Engine::emergency_stop`], puis `notify` (interface).
#[cfg(windows)]
pub fn start_guard<S, D, P>(
    engine: Arc<Mutex<Engine<S, D, P>>>,
    hotkey: Hotkey,
    notify: impl Fn(StopReason) + Send + 'static,
) -> Result<win::Guard, String>
where
    S: Sink + 'static,
    D: Screen + 'static,
    P: Pads + 'static,
{
    let local = engine.lock().unwrap_or_else(|e| e.into_inner()).injector.local().clone();
    win::Guard::start(
        hotkey,
        local,
        Box::new(move |reason| {
            // un verrou empoisonné ne doit pas empêcher l'arrêt d'urgence
            engine.lock().unwrap_or_else(|e| e.into_inner()).emergency_stop(reason);
            notify(reason);
        }),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::geometry::{desk_pixel, Rect};
    use super::*;
    use crate::remote_play::permissions::{Mode, Permission};
    use crate::remote_play::protocol::MouseButton;

    /// Enregistre ce qui serait passé à `SendInput`.
    #[derive(Default)]
    struct Recorder {
        sent: Arc<Mutex<Vec<OsInput>>>,
        foreign: bool,
        refuse: bool,
    }

    impl Sink for Recorder {
        fn send(&mut self, inputs: &[OsInput]) -> Result<(), InjectError> {
            if self.refuse {
                return Err(InjectError::Refused(5));
            }
            self.sent.lock().unwrap().extend_from_slice(inputs);
            Ok(())
        }
        fn foreign_input_since_last(&mut self) -> bool {
            self.foreign
        }
    }

    struct FakeScreen {
        desk: Rect,
        window: Option<Rect>,
    }

    impl Screen for FakeScreen {
        fn desktop(&self) -> Rect {
            self.desk
        }
        fn resolve(&self, area: &Area) -> Option<Rect> {
            match area {
                Area::Window(_) => self.window,
                Area::Monitor(_) => Some(Rect::new(0, 0, 1920, 1080)),
                _ => None,
            }
        }
    }

    #[derive(Default)]
    struct FakePads(Arc<Mutex<Vec<(u8, PadState)>>>);

    impl Pads for FakePads {
        fn update(&mut self, pad: u8, state: &PadState) -> Result<(), PadError> {
            self.0.lock().unwrap().push((pad, *state));
            Ok(())
        }
    }

    type Sent = Arc<Mutex<Vec<OsInput>>>;
    type PadLog = Arc<Mutex<Vec<(u8, PadState)>>>;

    fn engine_with(mode: Mode, area: Area, sink: Recorder, hooked: bool) -> (Engine<Recorder, FakeScreen, FakePads>, Sent, PadLog) {
        let sent = sink.sent.clone();
        let pads = FakePads::default();
        let pad_log = pads.0.clone();
        let local = Arc::new(LocalActivity::new());
        local.set_hooked(hooked);
        let screen = FakeScreen { desk: Rect::new(-1920, 0, 3840, 1080), window: Some(Rect::new(100, 200, 800, 600)) };
        let injector = Injector::new(sink, screen, pads, area, local);
        (Engine::new(Session::new(mode, []), injector), sent, pad_log)
    }

    fn engine(mode: Mode) -> (Engine<Recorder, FakeScreen, FakePads>, Sent, PadLog) {
        engine_with(mode, Area::Monitor(1), Recorder::default(), true)
    }

    fn key(scancode: u16, down: bool) -> Message {
        Message::Key { scancode, down }
    }
    fn os_key(scan: u8, extended: bool, up: bool) -> OsInput {
        OsInput::Key { scan, extended, up }
    }
    fn pad_msg(pad: u8, seq: u32, buttons: u16) -> Message {
        Message::Gamepad { pad, seq, state: PadState { buttons, ..Default::default() } }
    }
    fn take(sent: &Sent) -> Vec<OsInput> {
        std::mem::take(&mut *sent.lock().unwrap())
    }

    #[test]
    fn nothing_is_injected_without_permission() {
        let (mut e, sent, pads) = engine(Mode::DesktopShare);
        e.join(1, "ami").unwrap();
        assert_eq!(e.handle(1, key(0x1E, true)), Err(Denied::Missing(Permission::Keyboard)));
        assert_eq!(e.handle(1, Message::MouseAbs { seq: 1, x: 0, y: 0 }), Err(Denied::Missing(Permission::Mouse)));
        assert_eq!(e.handle(1, Message::MouseRel { seq: 2, dx: 1, dy: 1 }), Err(Denied::Missing(Permission::Mouse)));
        assert_eq!(e.handle(1, Message::Wheel { dx: 0, dy: 120 }), Err(Denied::Missing(Permission::Mouse)));
        assert_eq!(
            e.handle(1, Message::MouseButton { button: MouseButton::Left, down: true }),
            Err(Denied::Missing(Permission::Mouse))
        );
        assert_eq!(e.handle(1, pad_msg(0, 1, 1)), Err(Denied::Missing(Permission::Gamepad)));
        assert_eq!(e.handle(2, key(0x1E, true)), Err(Denied::UnknownParticipant));
        assert_eq!(e.handle(1, Message::Rumble { pad: 0, large: 1, small: 1 }), Err(Denied::WrongDirection));
        assert!(take(&sent).is_empty());
        assert!(pads.lock().unwrap().is_empty());
    }

    #[test]
    fn granted_keyboard_and_mouse_are_injected() {
        let (mut e, sent, _) = engine(Mode::DesktopShare);
        e.join(1, "ami").unwrap();
        e.set_profile(1, Profile::Collaborator, false).unwrap();
        e.handle(1, key(0x1E, true)).unwrap();
        e.handle(1, key(0xE04B, true)).unwrap();
        e.handle(1, Message::MouseRel { seq: 1, dx: -5, dy: 7 }).unwrap();
        e.handle(1, Message::MouseButton { button: MouseButton::X1, down: true }).unwrap();
        let done = e.handle(1, Message::Wheel { dx: -120, dy: 240 }).unwrap();
        assert_eq!(done, vec![Ok(Outcome::Injected)]);
        assert_eq!(e.handle(1, Message::Wheel { dx: 0, dy: 0 }).unwrap(), vec![Ok(Outcome::NoInput)]);
        assert_eq!(
            take(&sent),
            vec![
                os_key(0x1E, false, false),
                os_key(0x4B, true, false),
                OsInput::MoveRel { dx: -5, dy: 7 },
                OsInput::Button { button: MouseButton::X1, down: true },
                OsInput::Wheel { delta: 240 },
                OsInput::HWheel { delta: -120 },
            ]
        );
    }

    #[test]
    fn mode_ceiling_blocks_keyboard_in_game_share_but_pads_work() {
        let (mut e, sent, pads) = engine(Mode::GameShare);
        e.join(1, "ami").unwrap();
        e.set_profile(1, Profile::FullControl, true).unwrap();
        assert_eq!(e.handle(1, key(0x1E, true)), Err(Denied::Missing(Permission::Keyboard)));
        assert_eq!(e.handle(1, Message::MouseRel { seq: 1, dx: 1, dy: 1 }), Err(Denied::Missing(Permission::Mouse)));
        assert_eq!(e.handle(1, pad_msg(0, 1, 1)), Err(Denied::PadNotAssigned));
        e.assign_pad(1, Some(0)).unwrap();
        e.handle(1, pad_msg(0, 2, 0x1000)).unwrap();
        assert_eq!(e.handle(1, pad_msg(0, 2, 0x2000)), Err(Denied::Stale));
        assert!(take(&sent).is_empty());
        assert_eq!(*pads.lock().unwrap(), vec![(0, PadState { buttons: 0x1000, ..Default::default() })]);
    }

    #[test]
    fn spectators_and_watch_party_inject_nothing() {
        let (mut e, sent, _) = engine(Mode::WatchParty);
        e.join(1, "ami").unwrap();
        e.set_profile(1, Profile::Collaborator, false).unwrap();
        assert!(e.handle(1, key(0x1E, true)).is_err());
        let (mut e2, sent2, _) = engine(Mode::DesktopShare);
        e2.join(1, "ami").unwrap();
        e2.set_profile(1, Profile::Spectator, false).unwrap();
        assert!(e2.handle(1, Message::MouseAbs { seq: 1, x: 1, y: 1 }).is_err());
        assert!(take(&sent).is_empty() && take(&sent2).is_empty());
    }

    #[test]
    fn emergency_stop_releases_everything_and_blocks_input() {
        let (mut e, sent, pads) = engine(Mode::PersonalAccess);
        e.join(1, "a").unwrap();
        e.join(2, "b").unwrap();
        e.set_profile(1, Profile::FullControl, true).unwrap();
        e.set_profile(2, Profile::Player, false).unwrap();
        e.assign_pad(2, Some(1)).unwrap();
        e.handle(1, key(0x2A, true)).unwrap();
        e.handle(1, key(0xE01D, true)).unwrap();
        e.handle(1, Message::MouseButton { button: MouseButton::Left, down: true }).unwrap();
        e.handle(2, pad_msg(1, 1, 0x1000)).unwrap();
        take(&sent);
        pads.lock().unwrap().clear();

        let done = e.emergency_stop(StopReason::Hotkey);
        assert!(done.iter().all(|d| *d == Ok(Outcome::Injected)));
        let mut released = take(&sent);
        released.sort_by_key(|i| format!("{i:?}"));
        assert_eq!(
            released,
            vec![
                OsInput::Button { button: MouseButton::Left, down: false },
                os_key(0x1D, true, true),
                os_key(0x2A, false, true),
            ]
        );
        assert_eq!(*pads.lock().unwrap(), vec![(1, PadState::default())], "manette au neutre");
        assert_eq!(e.stop_reason(), Some(StopReason::Hotkey));

        assert_eq!(e.handle(1, key(0x1E, true)), Err(Denied::Suspended));
        assert_eq!(e.handle(2, pad_msg(1, 2, 1)), Err(Denied::Suspended));
        assert!(take(&sent).is_empty());

        // un second arrêt (ex. verrouillage juste après) ne relâche rien de plus
        assert!(e.emergency_stop(StopReason::Locked).iter().all(|d| d.is_ok()));
        assert!(take(&sent).is_empty());

        e.resume();
        assert_eq!(e.stop_reason(), None);
        e.handle(1, key(0x1E, true)).unwrap();
        assert_eq!(take(&sent), vec![os_key(0x1E, false, false)]);
    }

    #[test]
    fn releases_are_attempted_even_if_one_fails() {
        let (mut e, _, pads) = engine_with(Mode::PersonalAccess, Area::Desktop, Recorder { refuse: true, ..Default::default() }, true);
        e.join(1, "a").unwrap();
        e.set_profile(1, Profile::FullControl, true).unwrap();
        e.assign_pad(1, Some(0)).unwrap();
        // l'appui est refusé par Windows (ex. fenêtre administrateur) mais suivi par la session
        assert_eq!(e.handle(1, key(0x1E, true)).unwrap(), vec![Err(InjectError::Refused(5))]);
        e.handle(1, pad_msg(0, 1, 1)).unwrap();
        pads.lock().unwrap().clear();
        let done = e.leave(1);
        assert_eq!(done.len(), 2);
        assert_eq!(done[0], Err(InjectError::Refused(5)));
        assert_eq!(*pads.lock().unwrap(), vec![(0, PadState::default())], "la manette est relâchée malgré l'échec du clavier");
    }

    #[test]
    fn disconnect_block_and_rights_removal_release_what_was_held() {
        let (mut e, sent, pads) = engine(Mode::PersonalAccess);
        e.join(1, "a").unwrap();
        e.set_profile(1, Profile::FullControl, true).unwrap();
        e.assign_pad(1, Some(2)).unwrap();
        e.handle(1, key(0x11, true)).unwrap();
        e.handle(1, Message::MouseButton { button: MouseButton::Right, down: true }).unwrap();
        e.handle(1, pad_msg(2, 1, 0x1000)).unwrap();
        take(&sent);
        pads.lock().unwrap().clear();

        // retrait du clavier seulement
        e.set_grants(1, Grants::of(&[Permission::Mouse, Permission::Gamepad])).unwrap();
        assert_eq!(take(&sent), vec![os_key(0x11, false, true)]);
        // désactivation de la manette
        e.enable_pad(1, false).unwrap();
        assert_eq!(*pads.lock().unwrap(), vec![(2, PadState::default())]);
        // déconnexion : le bouton droit est relâché
        e.leave(1);
        assert_eq!(take(&sent), vec![OsInput::Button { button: MouseButton::Right, down: false }]);

        // blocage
        e.join(3, "c").unwrap();
        e.set_profile(3, Profile::Collaborator, false).unwrap();
        e.handle(3, key(0x39, true)).unwrap();
        take(&sent);
        e.block(3);
        assert_eq!(take(&sent), vec![os_key(0x39, false, true)]);
        assert_eq!(e.join(4, "c"), Err(Denied::Blocked));

        // resynchronisation périodique : une touche absente du KeyState est relâchée
        e.join(5, "d").unwrap();
        e.set_profile(5, Profile::Collaborator, false).unwrap();
        e.handle(5, key(0x1E, true)).unwrap();
        e.handle(5, key(0x1F, true)).unwrap();
        take(&sent);
        e.handle(5, Message::KeyState { seq: 1, held: vec![0x1F] }).unwrap();
        assert_eq!(take(&sent), vec![os_key(0x1E, false, true)]);

        // changement de manette : l'ancienne passe au neutre
        e.join(6, "e").unwrap();
        e.set_profile(6, Profile::Player, false).unwrap();
        e.assign_pad(6, Some(0)).unwrap();
        pads.lock().unwrap().clear();
        e.assign_pad(6, Some(1)).unwrap();
        assert_eq!(*pads.lock().unwrap(), vec![(0, PadState::default())]);
    }

    #[test]
    fn absolute_mouse_is_mapped_over_the_shared_area() {
        // bureau virtuel (-1920, 0) 3840×1080 ; fenêtre partagée (100, 200) 800×600
        let (mut e, sent, _) = engine_with(Mode::DesktopShare, Area::Window(42), Recorder::default(), true);
        e.join(1, "a").unwrap();
        e.set_profile(1, Profile::Collaborator, false).unwrap();
        e.handle(1, Message::MouseAbs { seq: 1, x: 0, y: 0 }).unwrap();
        e.handle(1, Message::MouseAbs { seq: 2, x: 65535, y: 65535 }).unwrap();
        let pixels: Vec<(i32, i32)> = take(&sent)
            .into_iter()
            .map(|i| match i {
                OsInput::MoveAbs { x, y } => (desk_pixel(x, -1920, 3840), desk_pixel(y, 0, 1080)),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(pixels, vec![(100, 200), (899, 799)]);

        // écran secondaire à gauche (origine négative)
        e.set_area(Area::Rect(Rect::new(-1920, 0, 1920, 1080)));
        e.handle(1, Message::MouseAbs { seq: 3, x: 32768, y: 0 }).unwrap();
        match take(&sent)[..] {
            [OsInput::MoveAbs { x, .. }] => assert_eq!(desk_pixel(x, -1920, 3840), -960),
            ref other => panic!("{other:?}"),
        }
    }

    #[test]
    fn vanished_window_injects_nothing() {
        let (mut e, sent, _) = engine_with(Mode::DesktopShare, Area::Window(42), Recorder::default(), true);
        e.injector.screen_mut_for_tests().window = None;
        e.join(1, "a").unwrap();
        e.set_profile(1, Profile::Collaborator, false).unwrap();
        assert_eq!(e.handle(1, Message::MouseAbs { seq: 1, x: 1, y: 1 }).unwrap(), vec![Err(InjectError::AreaGone)]);
        e.injector.screen_mut_for_tests().window = Some(Rect::new(0, 0, 0, 0));
        assert_eq!(e.handle(1, Message::MouseAbs { seq: 2, x: 1, y: 1 }).unwrap(), vec![Err(InjectError::AreaGone)]);
        assert!(take(&sent).is_empty());
    }

    #[test]
    fn local_input_has_priority_over_remote_mouse_for_500_ms() {
        let (mut e, sent, _) = engine(Mode::DesktopShare);
        e.join(1, "a").unwrap();
        e.set_profile(1, Profile::Collaborator, false).unwrap();
        e.handle(1, Message::MouseButton { button: MouseButton::Left, down: true }).unwrap();
        take(&sent);

        let t0 = Instant::now();
        e.injector.local().note(t0);
        let inj = &mut e.injector;
        let at = |ms| t0 + Duration::from_millis(ms);
        assert_eq!(inj.execute_at(&Message::MouseRel { seq: 1, dx: 1, dy: 0 }, at(10)), Ok(Outcome::LocalPriority));
        assert_eq!(inj.execute_at(&Message::MouseAbs { seq: 2, x: 1, y: 0 }, at(10)), Ok(Outcome::LocalPriority));
        assert_eq!(inj.execute_at(&Message::Wheel { dx: 0, dy: 120 }, at(100)), Ok(Outcome::LocalPriority));
        assert_eq!(
            inj.execute_at(&Message::MouseButton { button: MouseButton::Right, down: true }, at(100)),
            Ok(Outcome::LocalPriority)
        );
        // les relâchements et le clavier passent toujours
        assert_eq!(inj.execute_at(&Message::MouseButton { button: MouseButton::Left, down: false }, at(100)), Ok(Outcome::Injected));
        assert_eq!(inj.execute_at(&key(0x1E, true), at(100)), Ok(Outcome::Injected));
        // 500 ms sans activité locale : la souris distante reprend
        assert_eq!(inj.execute_at(&Message::MouseRel { seq: 3, dx: 2, dy: 0 }, at(500)), Ok(Outcome::Injected));
        assert_eq!(
            take(&sent),
            vec![
                OsInput::Button { button: MouseButton::Left, down: false },
                os_key(0x1E, false, false),
                OsInput::MoveRel { dx: 2, dy: 0 },
            ]
        );
    }

    #[test]
    fn heuristic_fallback_is_used_only_without_hooks() {
        let foreign = || Recorder { foreign: true, ..Default::default() };
        let (mut hooked, sent, _) = engine_with(Mode::DesktopShare, Area::Desktop, foreign(), true);
        assert_eq!(hooked.injector.execute(&Message::MouseRel { seq: 1, dx: 1, dy: 1 }), Ok(Outcome::Injected));
        assert_eq!(take(&sent).len(), 1);
        let (mut fallback, sent, _) = engine_with(Mode::DesktopShare, Area::Desktop, foreign(), false);
        assert_eq!(fallback.injector.execute(&Message::MouseRel { seq: 1, dx: 1, dy: 1 }), Ok(Outcome::LocalPriority));
        assert!(take(&sent).is_empty());
    }

    #[test]
    fn chat_and_ping_pass_authorization_but_inject_nothing() {
        let (mut e, sent, _) = engine(Mode::DesktopShare);
        e.join(1, "a").unwrap();
        e.set_grants(1, Grants::of(&[Permission::TextChat])).unwrap();
        assert_eq!(e.handle(1, Message::Chat { text: "salut".into() }).unwrap(), vec![Ok(Outcome::NoInput)]);
        assert_eq!(e.handle(1, Message::Ping { id: 1, micros: 2 }).unwrap(), vec![Ok(Outcome::NoInput)]);
        assert!(take(&sent).is_empty());
    }

    #[test]
    fn missing_vigem_is_reported_per_pad_message() {
        let local = Arc::new(LocalActivity::new());
        let screen = FakeScreen { desk: Rect::new(0, 0, 1920, 1080), window: None };
        let pads: Box<dyn Pads> = Box::new(NoPads);
        let mut e = Engine::new(Session::new(Mode::LocalMultiplayer, []), Injector::new(Recorder::default(), screen, pads, Area::Desktop, local));
        e.join(1, "a").unwrap();
        e.set_profile(1, Profile::Player, false).unwrap();
        e.assign_pad(1, Some(0)).unwrap();
        assert_eq!(e.handle(1, pad_msg(0, 1, 1)).unwrap(), vec![Err(InjectError::Pad(PadError::BusMissing))]);
    }
}
