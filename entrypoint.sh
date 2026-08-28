#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="${MODEL_DIR}/${MODEL_FILE}"

# --- Fetch model once, cache it on the mounted disk (see render.yaml) -----
if [ ! -f "${MODEL_PATH}" ]; then
    echo "[entrypoint] Model not found at ${MODEL_PATH}, downloading from:"
    echo "  ${MODEL_URL}"
    mkdir -p "${MODEL_DIR}"
    curl -L --fail --retry 3 --retry-delay 5 -o "${MODEL_PATH}.tmp" "${MODEL_URL}"
    mv "${MODEL_PATH}.tmp" "${MODEL_PATH}"
else
    echo "[entrypoint] Using cached model at ${MODEL_PATH}"
fi

# --- Figure out how many CPUs this container actually has -----------------
# Render sets a real cgroup CPU limit; nproc inside a container can lie
# and report the host's core count, so prefer the cgroup quota when present.
detect_cpus() {
    if [ -f /sys/fs/cgroup/cpu.max ]; then
        read -r quota period < /sys/fs/cgroup/cpu.max
        if [ "$quota" != "max" ]; then
            echo $(( (quota / period) > 0 ? (quota / period) : 1 ))
            return
        fi
    fi
    if [ -f /sys/fs/cgroup/cpu/cpu.cfs_quota_us ]; then
        quota=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us)
        period=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)
        if [ "$quota" -gt 0 ]; then
            echo $(( (quota / period) > 0 ? (quota / period) : 1 ))
            return
        fi
    fi
    nproc
}

CPU_COUNT="$(detect_cpus)"
echo "[entrypoint] Detected ${CPU_COUNT} usable CPU(s)"

# --- Launch server ----------------------------------------------------------
# --threads / --threads-batch: pinned to the real allocation, not nproc.
# --cont-batching: keep decode throughput up under concurrent requests.
# --mlock: best-effort; skip failure if the platform denies mlock rlimits.
# --no-mmap is deliberately NOT set -- mmap lets the OS page the model in
#   lazily and share pages across restarts, which is faster to boot, not
#   slower to run.
exec /app/llama-server \
    --model "${MODEL_PATH}" \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --threads "${CPU_COUNT}" \
    --threads-batch "${CPU_COUNT}" \
    --ctx-size "${CTX_SIZE}" \
    --batch-size "${BATCH_SIZE}" \
    --ubatch-size "${UBATCH_SIZE}" \
    --parallel "${PARALLEL_SLOTS}" \
    --cont-batching \
    --mlock \
    --n-predict "${N_PREDICT_DEFAULT}" \
    --metrics \
    --log-disable
