import { useMemo } from "react";
import { useSettings, type Region } from "@/services/settings";
import { Button, Segmented } from "@/components/ui/Button";
import { sound } from "@/services/sound";
import { FoldersPanel } from "@/components/library/FoldersPanel";
import { MetadataPanel } from "@/components/library/MetadataPanel";
import { IidbPanel } from "@/components/assets/IidbPanel";
import { CoverImage } from "@/components/game/CoverImage";
import { useLibrary } from "@/services/library";
import { isHidden, pcApi } from "@/services/pc";
import { DuplicatesButton } from "./SystemPage";
import { Group, Row, Toggle } from "./ui";

// ——— Bibliothèque ———

export function LibraryPage() {
  const s = useSettings();
  return (
    <>
      <Group title="Dossiers de jeux" icon="folder">
        <div className="border-none">
          <FoldersPanel />
        </div>
      </Group>
      <Group title="Doublons et versions" icon="copy">
        <Row label="Regrouper les doublons" note="Réunit les régions, révisions et copies d’un même jeu sur une seule fiche ; on choisit la version avant de jouer">
          <DuplicatesButton />
        </Row>
      </Group>
      <Group title="Préférences" icon="globe">
        <Row label="Région préférée" note="Variante de jaquette et de titre quand plusieurs régions existent">
          <Segmented<Region>
            label="Région préférée"
            value={s.preferredRegion}
            onChange={(v) => s.set("preferredRegion", v)}
            options={[
              { value: "PAL", label: "Europe" },
              { value: "NTSC-U", label: "États-Unis" },
              { value: "NTSC-J", label: "Japon" },
            ]}
          />
        </Row>
        <Row label="Jeux de démonstration" note="Les afficher même avec une vraie collection">
          <Toggle checked={s.showDemoGames} onChange={(v) => s.set("showDemoGames", v)} label="Jeux de démonstration" />
        </Row>
      </Group>
      <HiddenGamesGroup />
    </>
  );
}

/** Jeux et applications masqués (outils, logiciels…) : liste et réaffichage. */
function HiddenGamesGroup() {
  const realGames = useLibrary((l) => l.realGames);
  const reload = useLibrary((l) => l.reload);
  const hidden = useMemo(() => realGames.filter(isHidden).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle)), [realGames]);
  const unhide = async (ids: number[]) => {
    await Promise.all(ids.map((id) => pcApi.setHidden(id, false)));
    await reload();
    sound.play("select");
  };
  return (
    <Group title={`Jeux masqués · ${hidden.length}`} icon="lock" note="Masqués depuis leur fiche, ils restent installés ; réaffichez-les ici.">
      <div className="border-none">
        {hidden.length === 0 ? (
          <p className="rounded-xl bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">Aucun jeu masqué.</p>
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <Button icon="reset" onClick={() => void unhide(hidden.flatMap((g) => (g.pcInstalls ?? []).map((i) => i.id)))}>
                Tout réafficher
              </Button>
            </div>
            <div data-nav-group="settings-hidden" className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-3">
              {hidden.map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded-xl bg-cream-deep/70 p-2.5">
                  <div className="w-[3.2rem] shrink-0">
                    <CoverImage game={g} rounded="rounded-[0.45rem]" sheen={false} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.92rem] font-bold text-ink">{g.title}</div>
                    <div className="text-[0.75rem] font-semibold text-ink-soft">{(g.pcInstalls ?? []).map((i) => i.source).join(" · ")}</div>
                  </div>
                  <Button icon="reset" onClick={() => void unhide((g.pcInstalls ?? []).map((i) => i.id))}>
                    Réafficher
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Group>
  );
}

// ——— Images ———

export function ImagesPage() {
  const s = useSettings();
  return (
    <>
      <Group title="Jaquettes et informations" icon="front">
        <div className="border-none">
          <MetadataPanel />
        </div>
      </Group>
      <Group title="Illustrations iiDB" icon="database">
        <div className="border-none">
          <IidbPanel />
        </div>
      </Group>
      <Group title="Photos de profil" icon="user">
        <Row label="Portraits League of Legends" note="Icônes Riot Data Dragon chargées à la demande, sans clé">
          <Toggle checked={s.riotAvatars !== false} onChange={(value) => s.set("riotAvatars", value)} label="Portraits League of Legends" />
        </Row>
      </Group>
    </>
  );
}
