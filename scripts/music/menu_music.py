"""Compose et rend la musique de menu d'iBox (piste originale, synthèse pure).

Ambiance calme et ronde : piano électrique FM, marimba, basse douce, shaker.
Sortie : MP3 stéréo 44,1 kHz qui boucle sans coupure (queue de réverbération
repliée sur le début).
"""
import sys
import numpy as np

SR = 44100
BPM = 92
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ——— Harmonie (accords en MIDI) ———
CH = {
    "Fmaj7": [53, 57, 60, 64], "Am7": [57, 60, 64, 67], "Bbmaj7": [58, 62, 65, 69],
    "C7sus": [55, 58, 60, 65], "C7": [55, 58, 60, 64], "Dm7": [57, 60, 62, 65],
    "Gm7": [55, 58, 62, 65], "C9": [55, 58, 62, 64], "Bbm6": [55, 58, 61, 65],
    "Em7b5": [55, 58, 62, 64], "Fmaj9": [57, 60, 64, 67],
}
ROOT = {"Fmaj7": 41, "Am7": 45, "Bbmaj7": 46, "C7sus": 48, "C7": 48, "Dm7": 38, "Gm7": 43,
        "C9": 48, "Bbm6": 46, "Em7b5": 40, "Fmaj9": 41}
A = [["Fmaj7"], ["Am7"], ["Bbmaj7"], ["C7sus", "C7"], ["Fmaj7"], ["Dm7"], ["Gm7"], ["C9"]]
B = [["Bbmaj7"], ["Am7"], ["Gm7"], ["Am7"], ["Bbmaj7"], ["Bbm6"], ["Fmaj9"], ["Gm7", "C7"]]

# ——— Mélodie (temps dans la mesure, durée en temps, note) ———
MA = [
    [(0, 1, 72), (1, .5, 74), (1.5, .5, 76), (2, 1.5, 79), (3.5, .5, 76)],
    [(0, 1, 76), (1, 1, 74), (2, 2, 72)],
    [(0, .5, 74), (.5, .5, 72), (1, 1, 69), (2, 1, 70), (3, 1, 74)],
    [(0, 3, 72), (3, .5, 70), (3.5, .5, 69)],
    [(0, 1, 69), (1, .5, 72), (1.5, .5, 76), (2, 1.5, 81), (3.5, .5, 79)],
    [(0, 1, 77), (1, 1, 76), (2, 1, 74), (3, 1, 72)],
    [(0, 1.5, 74), (1.5, .5, 77), (2, 1, 76), (3, 1, 74)],
    [(0, 1, 72), (1, 1, 76), (2, 2, 79)],
]
MB = [
    [(0, 1.5, 77), (1.5, .5, 76), (2, 1, 74), (3, 1, 72)],
    [(0, 2, 76), (2, 1, 72), (3, 1, 69)],
    [(0, 1.5, 74), (1.5, .5, 72), (2, 1, 70), (3, 1, 67)],
    [(0, 3, 69), (3, 1, 72)],
    [(0, 1.5, 77), (1.5, .5, 79), (2, 1, 81), (3, 1, 77)],
    [(0, 2, 79), (2, 1, 77), (3, 1, 73)],
    [(0, 1.5, 72), (1.5, .5, 69), (2, 2, 76)],
    [(0, 1, 74), (1, 1, 72), (2, 1, 70), (3, 1, 67)],
]
# Deuxième passage : variation plus aérée de A
MA2 = [
    [(0, 1, 72), (1, .5, 74), (1.5, .5, 76), (2, 1, 79), (3, 1, 84)],
    [(0, 1.5, 81), (1.5, .5, 79), (2, 2, 76)],
    [(0, .5, 74), (.5, .5, 72), (1, 1, 69), (2, 1, 74), (3, 1, 77)],
    [(0, 2, 76), (2, 1, 74), (3, .5, 72), (3.5, .5, 70)],
    [(0, 1, 69), (1, .5, 72), (1.5, .5, 76), (2, 1.5, 81), (3.5, .5, 79)],
    [(0, 1, 77), (1, .5, 76), (1.5, .5, 77), (2, 1, 81), (3, 1, 77)],
    [(0, 1.5, 74), (1.5, .5, 77), (2, 1, 76), (3, 1, 74)],
    [(0, 1, 72), (1, 1, 74), (2, 1, 76), (3, 1, 79)],
]
MB2 = MB[:7] + [[(0, 1, 74), (1, 1, 72), (2, 2, 72)]]

FORM = [(A, MA, 0), (B, MB, 0), (A, MA2, 1), (B, MB2, 1)]
NBARS = sum(len(s[0]) for s in FORM)
LOOP = NBARS * BAR
TAIL = 4.0
N = int((LOOP + TAIL) * SR)
L = np.zeros(N)
R = np.zeros(N)


def add(sig, t0, gain, pan):
    i = int(t0 * SR)
    j = min(N, i + len(sig))
    if j <= i:
        return
    s = sig[: j - i] * gain
    L[i:j] += s * np.cos((pan + 1) * np.pi / 4)
    R[i:j] += s * np.sin((pan + 1) * np.pi / 4)


def env(n, a, d, rel=0.02, hold=None):
    t = np.arange(n) / SR
    e = np.minimum(1, t / a) * np.exp(-t / d)
    if hold is not None:
        k = int(hold * SR)
        r = int(rel * SR)
        if k < n:
            fade = np.ones(n)
            fade[k:k + r] = np.linspace(1, 0, min(r, n - k))[: len(fade[k:k + r])]
            fade[k + r:] = 0
            e *= fade
    return e


def ep(m, dur, vel=1.0):
    """Piano électrique FM (ratio 1:1, indice qui décroît)."""
    f = hz(m)
    n = int((dur + 1.6) * SR)
    t = np.arange(n) / SR
    idx = 1.6 * np.exp(-t / 0.35) + 0.15
    s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    s += 0.12 * np.sin(2 * np.pi * 14 * f * t) * np.exp(-t / 0.02)  # petit « tine »
    return s * env(n, 0.004, 1.4, rel=0.25, hold=dur + 0.2) * vel


def marimba(m, dur, vel=1.0):
    f = hz(m)
    n = int((dur + 1.0) * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.75)
    s += 0.35 * np.sin(2 * np.pi * 3.93 * f * t) * np.exp(-t / 0.12)
    s += 0.08 * np.sin(2 * np.pi * 9.2 * f * t) * np.exp(-t / 0.02)
    return s * np.minimum(1, t / 0.002) * vel


def bell(m, dur, vel=1.0):
    f = hz(m)
    n = int((dur + 2.0) * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t + 1.2 * np.exp(-t / 0.5) * np.sin(2 * np.pi * 3.5 * f * t))
    return s * np.minimum(1, t / 0.003) * np.exp(-t / 1.1) * vel


def bass(m, dur):
    f = hz(m)
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.15)
    return s * env(n, 0.008, 0.9, rel=0.08, hold=dur)


def pad(notes, dur):
    n = int((dur + 1.0) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for m in notes:
        for det in (-0.6, 0.6):
            s += np.sin(2 * np.pi * (hz(m + 12) + det) * t)
    a = np.minimum(1, t / 0.8) * np.clip((dur + 1.0 - t) / 1.0, 0, 1)
    return s * a / (2 * len(notes))


def shaker(vel):
    n = int(0.09 * SR)
    x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))  # passe-haut grossier
    return x * np.exp(-np.arange(n) / SR / 0.025) * vel


def rim():
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * 1700 * t) * np.exp(-t / 0.012) + 0.4 * rng.standard_normal(n) * np.exp(-t / 0.006)
    return s


def kick():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    f = 55 + 60 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12)


t = 0.0
bar_no = 0
for chords, mel, pass_ in FORM:
    for b in range(len(chords)):
        names = chords[b]
        half = len(names) == 2
        for k, name in enumerate(names):
            t0 = t + (2 * BEAT if (half and k == 1) else 0)
            span = 2 if half else 4
            # piano électrique : 1, 2+, (3+) — léger balancement
            hits = [(0, 1.4, 0.9), (1.5, 0.5, 0.6), (2.5, 1.3, 0.75)] if span == 4 else [(0, 1.4, 0.85), (1.5, 0.5, 0.6)]
            for (ofs, d, v) in hits:
                for i, m in enumerate(CH[name]):
                    add(ep(m, d * BEAT, v), t0 + ofs * BEAT + i * 0.006, 0.055, -0.25)
            # basse : fondamentale, quinte, approche
            r = ROOT[name]
            add(bass(r, 1.4 * BEAT), t0, 0.32, 0.0)
            if span == 4:
                add(bass(r + 7, 0.9 * BEAT), t0 + 2.5 * BEAT, 0.26, 0.0)
                nxt = None
                add(bass(r + 12 if bar_no % 2 else r + 7, 0.4 * BEAT), t0 + 3.5 * BEAT, 0.18, 0.0)
            else:
                add(bass(r + 7, 0.4 * BEAT), t0 + 1.5 * BEAT, 0.2, 0.0)
            if pass_ == 1:
                add(pad(CH[name], span * BEAT), t0, 0.05, 0.3)
        # mélodie
        for (ofs, d, m) in mel[b]:
            st = t + ofs * BEAT
            v = 0.9 if ofs % 1 == 0 else 0.7
            add(marimba(m, d * BEAT, v), st, 0.16, 0.15)
            if pass_ == 1:
                add(bell(m + 12, d * BEAT, v), st + 0.012, 0.045, -0.35)
        # percussions
        for e in range(8):
            v = 0.06 if e % 2 else 0.035
            add(shaker(v), t + e * 0.5 * BEAT + (0.012 if e % 2 else 0), 1.0, 0.45)
        add(rim(), t + 1 * BEAT, 0.045, -0.1)
        add(rim(), t + 3 * BEAT, 0.045, -0.1)
        add(kick(), t, 0.16, 0.0)
        add(kick(), t + 2.5 * BEAT, 0.09, 0.0)
        t += BAR
        bar_no += 1

# ——— Réverbération (convolution par FFT avec une réponse synthétique) ———
ir_n = int(2.2 * SR)
it = np.arange(ir_n) / SR
irL = rng.standard_normal(ir_n) * np.exp(-it / 0.55)
irR = rng.standard_normal(ir_n) * np.exp(-it / 0.55)
for ir in (irL, irR):
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))


def conv(x, h):
    m = len(x) + len(h) - 1
    nfft = 1 << (m - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)[:m]


wetL = conv(L, irL)[:N]
wetR = conv(R, irR)[:N]
L = L + 0.55 * wetL
R = R + 0.55 * wetR

# Boucle sans coupure : la queue (après LOOP) se replie sur le début
ln = int(LOOP * SR)
outL = L[:ln].copy()
outR = R[:ln].copy()
tail = N - ln
outL[:tail] += L[ln:]
outR[:tail] += R[ln:]

# Douceur : légère compression + normalisation
mix = np.stack([outL, outR], axis=1)
mix = np.tanh(mix * 1.6) / 1.6
mix *= 0.7 / np.max(np.abs(mix))

pcm = (mix * 32767).astype(np.int16)
import lameenc  # noqa: E402

enc = lameenc.Encoder()
enc.set_bit_rate(160)
enc.set_in_sample_rate(SR)
enc.set_channels(2)
enc.set_quality(2)
data = enc.encode(pcm.tobytes()) + enc.flush()
open(sys.argv[1], "wb").write(data)
if len(sys.argv) > 2:
    import wave
    w = wave.open(sys.argv[2], "wb")
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes()); w.close()
print(f"{NBARS} mesures, {LOOP:.1f} s, {len(data) / 1e6:.2f} Mo")
