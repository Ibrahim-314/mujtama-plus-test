# Local search model (v2.125)

minishlab/potion-multilingual-128M — Model2Vec static embeddings distilled from BAAI/bge-m3. Licence: MIT.
Pruned to Arabic + the 70k most frequent ASCII Latin pieces (105,942 pieces × 256 dims), int8 per-row quantised.

- vocab.json        [piece, unigram log-prob] in model order
- vec.i8.partNN     int8 vectors, row-major, joined in order (split to stay under 4 MB per file)
- scale.f32         per-row scale (float32): vector = int8 × scale / 127

Rebuild: tools/build-search-model.py (downloads the model from Hugging Face and writes these files).
