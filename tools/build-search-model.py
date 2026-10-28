"""v2.125 — rebuild server/models/m2v from minishlab/potion-multilingual-128M (MIT).
Keeps Arabic pieces + the 70k most frequent ASCII Latin pieces, int8 per-row quantisation, vectors split into <4 MB parts.
Usage: python3 tools/build-search-model.py  (needs numpy; downloads ~530 MB once into /tmp/m2v)"""
import json, struct, re, os, urllib.request, numpy as np
SRC = "https://huggingface.co/minishlab/potion-multilingual-128M/resolve/main/"
TMP, OUT = "/tmp/m2v", os.path.join(os.path.dirname(__file__), "..", "server", "models", "m2v")
os.makedirs(TMP, exist_ok=True); os.makedirs(OUT, exist_ok=True)
for f in ("tokenizer.json", "model.safetensors"):
    if not os.path.exists(os.path.join(TMP, f)): urllib.request.urlretrieve(SRC + f, os.path.join(TMP, f))
V = json.load(open(os.path.join(TMP, "tokenizer.json")))["model"]["vocab"]
arab = re.compile(r'^[\u2581\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF0-9٠-٩!-/:-@\[-`{-~،؛؟«»…–—’‘“”]+$')
asc = re.compile(r'^[\u2581a-zA-Z0-9!-/:-@\[-`{-~]+$')
A = [i for i, (t, s) in enumerate(V) if i < 4 or arab.match(t)]
L = sorted([i for i, (t, s) in enumerate(V) if asc.match(t) and not arab.match(t)], key=lambda i: -V[i][1])
keep = sorted(set(A) | set(L[:70000]))
f = open(os.path.join(TMP, "model.safetensors"), "rb"); n = struct.unpack("<Q", f.read(8))[0]; h = json.loads(f.read(n))
a, _ = h["embeddings"]["data_offsets"]; rows, dim = h["embeddings"]["shape"]
E = np.memmap(os.path.join(TMP, "model.safetensors"), dtype="<f4", mode="r", offset=8 + n + a, shape=(rows, dim))
K = np.array(E[keep]); sc = np.abs(K).max(1); sc[sc == 0] = 1
Q = np.round(K / sc[:, None] * 127).astype(np.int8).tobytes()
for i in range(0, len(Q), 3800000): open(os.path.join(OUT, "vec.i8.part%02d" % (i // 3800000)), "wb").write(Q[i:i + 3800000])
open(os.path.join(OUT, "scale.f32"), "wb").write(sc.astype("<f4").tobytes())
json.dump([[V[i][0], round(V[i][1], 3)] for i in keep], open(os.path.join(OUT, "vocab.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print(len(keep), "pieces")
