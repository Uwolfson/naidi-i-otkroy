# -*- coding: utf-8 -*-
"""Вырезать из mp3 нужные секунды, не перекодируя.

   Целая запись на карточку не нужна: игра всё равно играет две с половиной
   секунды. Но скачивается она целиком, и экран выбора темы тянет сразу
   дюжину файлов — на планшете по мобильной сети это заметно.

   Режем по границам кадров: кадр mp3 самодостаточен, так что достаточно
   выбросить лишние и склеить оставшиеся. Первый кадр после разреза может
   звучать чуть беднее — он рассчитывал на запас битов от предыдущего, —
   но это двадцать шесть миллисекунд.

       python tools/trim.py <файл.mp3> <начало> <длительность>
"""
import sys, os

RATE = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}
BITS_V1 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0]
BITS_V2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0]

def frames(b):
    """Границы кадров: (смещение, длина, длительность)."""
    i = 0
    if b[:3] == b"ID3":
        i = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127))
    while i + 4 <= len(b):
        if b[i] != 0xFF or (b[i+1] & 0xE0) != 0xE0:
            i += 1; continue
        ver, layer = (b[i+1] >> 3) & 3, (b[i+1] >> 1) & 3
        bi, si, pad = b[i+2] >> 4, (b[i+2] >> 2) & 3, (b[i+2] >> 1) & 1
        if ver == 1 or layer != 1 or bi in (0, 15) or si == 3:
            i += 1; continue
        sr = RATE[ver][si]
        br = (BITS_V1 if ver == 3 else BITS_V2)[bi] * 1000
        spf = 1152 if ver == 3 else 576
        ln = int(spf // 8 * br // sr) + pad
        if ln < 24: i += 1; continue
        yield i, ln, spf / sr
        i += ln

def trim(path, start, dur):
    b = open(path, "rb").read()
    keep, t = [], 0.0
    for off, ln, d in frames(b):
        if t >= start and t < start + dur: keep.append(b[off:off+ln])
        t += d
        if t >= start + dur: break
    if not keep: raise SystemExit("%s: кадров не нашлось" % path)
    was = len(b)
    open(path, "wb").write(b"".join(keep))
    print("%-24s %d -> %d КБ, %.1f с" % (os.path.basename(path), was//1024,
                                         len(b"".join(keep))//1024, len(keep)*0.026), flush=True)

if __name__ == "__main__":
    trim(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
