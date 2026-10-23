/* Tiny Prometheus registry (phase 49): counters, gauges and histograms with labels, rendered in the
 * Prometheus text exposition format 0.0.4. No dependency. Label values are escaped; cardinality is the
 * caller's job (routes are normalised to their patterns, status to its class). */
const esc = v => String(v).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
const lbl = (o = {}) => {
  const k = Object.keys(o);
  return k.length ? "{" + k.map(x => `${x}="${esc(o[x])}"`).join(",") + "}" : "";
};
const keyOf = o =>
  JSON.stringify(
    Object.keys(o || {})
      .sort()
      .map(k => [k, String(o[k])])
  );
const num = v => (Number.isFinite(v) ? String(v) : v > 0 ? "+Inf" : v < 0 ? "-Inf" : "NaN");

function createRegistry({ prefix = "" } = {}) {
  const metrics = new Map();
  function def(type, name, help, extra = {}) {
    const full = prefix + name;
    if (metrics.has(full)) return metrics.get(full);
    const m = { type, name: full, help, series: new Map(), ...extra };
    metrics.set(full, m);
    return m;
  }
  function series(m, labels) {
    const k = keyOf(labels);
    let s = m.series.get(k);
    if (!s) {
      s = { labels: { ...(labels || {}) }, value: 0, counts: m.buckets ? m.buckets.map(() => 0) : null, sum: 0, count: 0 };
      m.series.set(k, s);
    }
    return s;
  }
  return {
    counter(name, help) {
      const m = def("counter", name, help);
      return {
        inc(labels, v = 1) {
          series(m, labels).value += v;
        },
        get: labels => series(m, labels).value
      };
    },
    gauge(name, help, collect) {
      const m = def("gauge", name, help, { collect });
      return {
        set(labels, v) {
          series(m, labels).value = v;
        },
        get: labels => series(m, labels).value
      };
    },
    histogram(name, help, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
      const m = def("histogram", name, help, { buckets });
      return {
        observe(labels, v) {
          const s = series(m, labels);
          for (let i = 0; i < buckets.length; i++) if (v <= buckets[i]) s.counts[i]++;
          s.sum += v;
          s.count++;
        }
      };
    },
    /** @returns {Promise<string>} */
    async render() {
      const out = [];
      for (const m of metrics.values()) {
        if (m.collect) {
          try {
            await m.collect();
          } catch {
            /* a failed collector leaves the last values */
          }
        }
        out.push(`# HELP ${m.name} ${String(m.help).replace(/\n/g, " ")}`, `# TYPE ${m.name} ${m.type}`);
        for (const s of m.series.values()) {
          if (m.type !== "histogram") {
            out.push(`${m.name}${lbl(s.labels)} ${num(s.value)}`);
            continue;
          }
          m.buckets.forEach((b, i) => out.push(`${m.name}_bucket${lbl({ ...s.labels, le: b })} ${s.counts[i]}`));
          out.push(
            `${m.name}_bucket${lbl({ ...s.labels, le: "+Inf" })} ${s.count}`,
            `${m.name}_sum${lbl(s.labels)} ${num(Math.round(s.sum * 1e6) / 1e6)}`,
            `${m.name}_count${lbl(s.labels)} ${s.count}`
          );
        }
      }
      return out.join("\n") + "\n";
    },
    metrics
  };
}
module.exports = { createRegistry, escapeLabel: esc };
