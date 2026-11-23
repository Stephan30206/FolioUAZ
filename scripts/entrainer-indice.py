"""Recalcul du repère expérimental à partir de l'archive data.tar.gz de HC3 Multi.

Appel : python scripts/entrainer-indice.py chemin/vers/data.tar.gz
Dépendances d'entraînement : Node.js, Python, NumPy et scikit-learn.
Les textes d'entraînement ne sont pas distribués dans l'application.
"""
import json
import hashlib
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
REV = "34acd9cc5eb1f9855d3485c7783f28a235dd87bd"
result = {"dataset":"almanach/hc3_multi", "revision":REV, "license":"CC BY-SA 4.0", "models":{}}
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for lang in ("fr", "en"):
        used = set()
        parts = {key:([],[]) for key in ("train","val","test")}
        for split in ("train", "val", "test"):
            name = f"data/hc3_{lang}/{split}_full_examples.json"
            with tempfile.TemporaryFile() as source:
                source.write(archive.extractfile(name).read())
                source.seek(0)
                output = subprocess.check_output(["node", str(ROOT/"scripts/echantillons-style.mjs"), lang], stdin=source)
            for row in output.splitlines():
                group, fingerprint, label, vector = json.loads(row)
                if fingerprint in used:
                    continue
                used.add(fingerprint)
                # Original files can overlap. Reserve whole question groups.
                fold = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) % 100
                part = "train" if fold < 65 else "val" if fold < 80 else "test"
                parts[part][0].append(vector)
                parts[part][1].append(label)
        splits = {key: (np.array(x), np.array(y)) for key,(x,y) in parts.items()}
        train_x, train_y = splits["train"]
        scale = StandardScaler().fit(train_x)
        model = LogisticRegression(C=0.35, max_iter=500, class_weight="balanced").fit(scale.transform(train_x), train_y)
        # Merge centering/scaling into a linear score for a small local runtime.
        weights = model.coef_[0]/scale.scale_
        bias = float(model.intercept_[0]-np.dot(weights,scale.mean_))
        val_x,val_y = splits["val"]
        threshold = float(np.quantile(val_x[val_y==0]@weights+bias, .95, method="higher"))
        test_x,test_y = splits["test"]
        flags = (test_x@weights+bias)>threshold
        report = {"human":int(sum(test_y==0)), "falseSignals":int(sum(flags & (test_y==0))),
                  "generated":int(sum(test_y==1)), "detected":int(sum(flags & (test_y==1)))}
        result["models"][lang] = {"weights":weights.round(9).tolist(), "bias":bias, "threshold":threshold, "test":report}
        print(lang, "entraînement", len(train_y), "validation", len(val_y), "test", report, flush=True)
(ROOT/"src/style-model.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
