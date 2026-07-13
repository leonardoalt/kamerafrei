VENV := .venv
PY   := $(VENV)/bin/python

# Small test area: Kreuzberg around Kottbusser Tor
TEST_POINT := 52.499,13.418
TEST_DIST  := 1500
TEST_BBOX  := 52.485,13.395,52.513,13.441

.PHONY: venv cameras graphs exposure berlin test-area serve clean

venv:
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -U pip
	$(VENV)/bin/pip install -r requirements.txt

cameras:
	$(PY) pipeline/fetch_cameras.py

graphs:
	$(PY) pipeline/build_graph.py --profile both

exposure:
	$(PY) pipeline/compute_exposure.py --graph data/graph_walk.pkl.gz
	$(PY) pipeline/compute_exposure.py --graph data/graph_bike.pkl.gz

export-web:
	$(PY) pipeline/export_web.py --graph data/graph_walk.pkl.gz --out data/web/graph_walk.bin
	$(PY) pipeline/export_web.py --graph data/graph_bike.pkl.gz --out data/web/graph_bike.bin

# client router must agree with the Python oracle
verify-client:
	$(PY) scripts/parity_check.py -n 50

# Full Berlin build (network download is the slow part)
berlin: cameras graphs exposure export-web

# Quick end-to-end test on a small Kreuzberg area
test-area:
	$(PY) pipeline/fetch_cameras.py --bbox $(TEST_BBOX)
	$(PY) pipeline/build_graph.py --profile both --point $(TEST_POINT) --dist $(TEST_DIST)
	$(PY) pipeline/compute_exposure.py --graph data/graph_walk.pkl.gz
	$(PY) pipeline/compute_exposure.py --graph data/graph_bike.pkl.gz
	$(MAKE) export-web

serve:
	$(VENV)/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log

clean:
	rm -rf data
