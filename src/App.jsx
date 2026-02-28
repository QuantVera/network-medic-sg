import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BadgeCheck,
  BadgeX,
  CircleHelp,
  Gauge,
  Globe,
  Info,
  Layers,
  Loader2,
  Lock,
  Network,
  ShieldAlert,
  Signal,
  Timer,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";

/**
 * Network Medic — client-only diagnostic helper (React + Tailwind)
 *
 * Privacy posture:
 * - No accounts, no analytics, no tracking.
 * - External diagnostics are OFF by default.
 * - When enabled, this app performs outbound HTTPS requests to public endpoints
 *   purely to infer connectivity (browser-safe; no ICMP ping).
 *
 * Security posture:
 * - No third-party scripts.
 * - No persistent storage required.
 */

const BRAND = {
  name: "Network Medic",
  tagline: "Signal bars but no internet? Let’s diagnose your connection.",
};

// Prefer domain endpoints (raw IP often blocked on mobile networks)
const ENDPOINTS = {
  // 204 endpoints: common connectivity checks
  google204: "https://www.google.com/generate_204",
  gstatic204: "https://www.gstatic.com/generate_204",

  // Cloudflare domain endpoints (more reliable than 1.1.1.1 IP)
  cfTrace: "https://one.one.one.one/cdn-cgi/trace",
  cfHome: "https://www.cloudflare.com/",

  // DoH (best-effort; may be blocked/opaque)
  dohCloudflare: "https://cloudflare-dns.com/dns-query?name=example.com&type=A",
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

async function timedFetch(url, timeoutMs = 2500, extraHeaders = {}) {
  const controller = new AbortController();
  const start = performance.now();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // NOTE:
    // - no-cors yields opaque responses but still measures timing
    // - this is intentional: avoids reading content; safer for privacy
    const res = await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: extraHeaders,
    });

    const end = performance.now();
    return {
      ok: true, // "ok" means fetch completed; in no-cors it doesn't mean status 200
      status: typeof res?.status === "number" ? res.status : 0,
      type: res?.type || "opaque",
      opaque: res?.type === "opaque",
      ms: Math.round(end - start),
    };
  } catch (e) {
    const end = performance.now();
    return {
      ok: false,
      status: 0,
      type: "error",
      opaque: false,
      ms: Math.round(end - start),
      error: e?.name || "FetchError",
    };
  } finally {
    clearTimeout(id);
  }
}

function getNetworkHint() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) {
    return { supported: false, effectiveType: "unknown", downlink: null, rtt: null, saveData: null };
  }
  return {
    supported: true,
    effectiveType: conn.effectiveType || "unknown",
    downlink: typeof conn.downlink === "number" ? conn.downlink : null,
    rtt: typeof conn.rtt === "number" ? conn.rtt : null,
    saveData: typeof conn.saveData === "boolean" ? conn.saveData : null,
  };
}

function supportsLongTask() {
  try {
    return typeof PerformanceObserver !== "undefined";
  } catch {
    return false;
  }
}

function reliabilityScore({ externalChecksEnabled, networkHintSupported, longTaskSupported }) {
  if (!externalChecksEnabled) {
    return {
      level: "low",
      label: "Low",
      note: "External diagnostics are OFF — results are guidance-only.",
    };
  }

  const extras = (networkHintSupported ? 1 : 0) + (longTaskSupported ? 1 : 0);

  if (extras >= 2) {
    return {
      level: "high",
      label: "High",
      note: "External probes + device signals available (best accuracy this browser can offer).",
    };
  }

  if (extras === 1) {
    return {
      level: "medium",
      label: "Medium",
      note: "External probes available, but some device/network APIs are not supported.",
    };
  }

  return {
    level: "medium",
    label: "Medium",
    note: "External probes available. Device/network hints are limited on this browser.",
  };
}

function classifyHealth({ online, externalChecksEnabled, latencyMs, dnsOk, captiveLikely }) {
  if (!online) {
    return {
      level: "red",
      title: "No Connectivity",
      detail: "Device reports offline, or the network blocks outbound traffic.",
      label: "OFFLINE",
      icon: BadgeX,
    };
  }

  if (!externalChecksEnabled) {
    return {
      level: "amber",
      title: "Limited Scan Mode",
      detail: "External diagnostics are OFF. Enable them for deeper checks.",
      label: "PRIVACY MODE",
      icon: Lock,
    };
  }

  if (captiveLikely) {
    return {
      level: "amber",
      title: "Captive Portal Suspected",
      detail: "You may be stuck on a Wi-Fi login/intercept page.",
      label: "LOGIN REQUIRED",
      icon: ShieldAlert,
    };
  }

  if (dnsOk === false) {
    return {
      level: "amber",
      title: "DNS / APN Issue",
      detail: "Transport looks reachable but domains fail (often APN/VPN/Private DNS).",
      label: "DNS DEGRADED",
      icon: Globe,
    };
  }

  if (latencyMs != null && latencyMs >= 900) {
    return {
      level: "amber",
      title: "Congestion / Stall",
      detail: "Latency is extremely high — congestion, weak coverage, or a stalled session.",
      label: "CONGESTION / STALL",
      icon: Activity,
    };
  }

  return {
    level: "green",
    title: "Healthy",
    detail: "Connectivity looks normal based on browser-safe diagnostics.",
    label: "OK",
    icon: BadgeCheck,
  };
}

function detectCarrierHint() {
  // Browser carrier detection is weak; keep best-effort only.
  const ua = (navigator.userAgent || "").toLowerCase();
  const rules = [
    { key: "simba", match: ["simba", "tpg"] },
    { key: "singtel", match: ["singtel"] },
    { key: "starhub", match: ["starhub"] },
    { key: "m1", match: [" m1", "m1 "] },
  ];
  for (const r of rules) {
    if (r.match.some((m) => ua.includes(m))) return r.key;
  }
  return "unknown";
}

const CARRIER_APN = {
  simba: { name: "SIMBA (TPG)", apn: "tpg", notes: "If you have bars but no data, SIMBA often needs APN set to ‘tpg’." },
  singtel: { name: "Singtel", apn: "(auto)", notes: "Usually auto-configures. If issues persist, reset network settings." },
  starhub: { name: "StarHub", apn: "(auto)", notes: "Usually auto-configures. Verify mobile data is ON and plan not throttled." },
  m1: { name: "M1", apn: "(auto)", notes: "Usually auto-configures. If DNS seems broken, toggle airplane mode and retry." },
  unknown: {
    name: "Unknown Carrier",
    apn: "(check carrier docs)",
    notes: "Carrier detection isn’t reliable in browsers. Select your carrier for APN guidance.",
  },
};

function Badge({ level, label }) {
  const styles =
    level === "green"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"
      : level === "amber"
        ? "bg-amber-500/15 text-amber-200 ring-amber-500/25"
        : "bg-rose-500/15 text-rose-200 ring-rose-500/25";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide ring-1 ${styles}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${level === "green" ? "bg-emerald-300" : level === "amber" ? "bg-amber-200" : "bg-rose-200"}`} />
      {label}
    </span>
  );
}

function ReliabilityBadge({ level, label }) {
  const styles =
    level === "high"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"
      : level === "medium"
        ? "bg-amber-500/15 text-amber-200 ring-amber-500/25"
        : "bg-zinc-500/15 text-zinc-200 ring-zinc-500/25";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide ring-1 ${styles}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${level === "high" ? "bg-emerald-300" : level === "medium" ? "bg-amber-200" : "bg-zinc-200"}`} />
      Reliability: {label}
    </span>
  );
}

function MetricRow({ icon: Icon, label, value, sub, status }) {
  const tint =
    status === "good" ? "text-emerald-300" : status === "warn" ? "text-amber-200" : status === "bad" ? "text-rose-200" : "text-zinc-300";

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-xl bg-white/5 p-2 ${tint}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">{label}</div>
          {sub ? <div className="mt-0.5 text-xs text-zinc-400">{sub}</div> : null}
        </div>
      </div>
      <div className="text-right">
        <div className={`text-sm font-bold ${tint}`}>{value}</div>
      </div>
    </div>
  );
}

function Card({ title, icon: Icon, children, right, help }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-white/5 p-2 text-zinc-200">
            <Icon className="h-5 w-5" />
          </div>
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
        </div>
        {right}
      </div>
      {help ? <div className="mb-3 text-xs text-zinc-400">{help}</div> : null}
      {children}
    </div>
  );
}

function Toggle({ enabled, onChange, label, hint, icon: Icon = Lock }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 ring-1 ring-white/10">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Icon className="h-4 w-4 text-zinc-300" />
          <span className="truncate">{label}</span>
        </div>
        {hint ? <div className="mt-1 text-xs text-zinc-400">{hint}</div> : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`relative h-7 w-12 flex-shrink-0 rounded-full ring-1 transition ${
          enabled ? "bg-emerald-500/30 ring-emerald-500/30" : "bg-white/10 ring-white/15"
        }`}
        aria-pressed={enabled}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-zinc-950 ring-1 ring-white/20 transition ${enabled ? "left-5" : "left-0.5"}`} />
      </button>
    </div>
  );
}

function ProgressPill({ step, total, label }) {
  const pct = total <= 0 ? 0 : (step / total) * 100;
  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span>
          {step}/{total}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-white/20" style={{ width: `${clamp(pct, 0, 100)}%` }} />
      </div>
    </div>
  );
}

function formatDeltaMs(delta) {
  if (delta == null) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ms`;
}

function buildAutoSuggestion({ externalChecksEnabled, latestResult, abDeltaMs }) {
  if (!externalChecksEnabled || !latestResult) return null;

  const bestMs = latestResult.latency?.bestMs ?? null;
  const dnsOk = latestResult.dns?.ok ?? null;
  const captive = latestResult.captive?.suspected ?? null;

  // Captive portal suggestion
  if (captive === true) {
    return "Captive portal suspected — turn OFF Wi-Fi, open a browser to complete login, then re-scan.";
  }

  // DNS issue suggestion
  if (dnsOk === false) {
    return "Domains failing but transport reachable — disable VPN/Private DNS, verify APN, then toggle airplane mode and re-scan.";
  }

  // High latency suggestion
  if (bestMs != null && bestMs >= 900) {
    return "Latency extremely high — try switching to 4G/LTE-only temporarily, move near a window, toggle airplane mode (10s), then re-scan.";
  }

  // A/B delta suggestion
  if (abDeltaMs != null && abDeltaMs <= -250) {
    return "Big improvement after airplane mode — likely a stalled data session. If frequent: reboot phone or re-seat SIM.";
  }

  if (abDeltaMs != null && abDeltaMs >= 250) {
    return "Latency worsened after reset — likely congestion/coverage. Try a different spot/time and re-scan.";
  }

  return "If apps still fail despite a healthy scan: check Data Saver, VPN, Private DNS, and background restrictions.";
}

export default function NetworkMedic() {
  const [stage, setStage] = useState("idle"); // idle | scanning | done
  const [progress, setProgress] = useState(0);

  const [externalChecksEnabled, setExternalChecksEnabled] = useState(false);
  const [abModeEnabled, setAbModeEnabled] = useState(true);
  const [abPhase, setAbPhase] = useState("none"); // none | baselineDone | afterDone

  const [carrier, setCarrier] = useState(() => detectCarrierHint());
  const carrierInfo = CARRIER_APN[carrier] || CARRIER_APN.unknown;

  const [baseline, setBaseline] = useState(null);
  const [after, setAfter] = useState(null);

  const [longTaskMs, setLongTaskMs] = useState(0);
  const longTaskMsRef = useRef(0);
  const perfObsRef = useRef(null);

  const timerRef = useRef(null);

  const [scanMeta, setScanMeta] = useState({
    timestamp: null,
    online: typeof navigator.onLine === "boolean" ? navigator.onLine : true,
    networkHint: getNetworkHint(),
  });

  const netHint = scanMeta.networkHint;
  const longTaskSupported = supportsLongTask();

  useEffect(() => {
    const onOnline = () => {
      setScanMeta((s) => ({
        ...s,
        online: typeof navigator.onLine === "boolean" ? navigator.onLine : true,
      }));
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);

  function startPerfObserver() {
    longTaskMsRef.current = 0;
    setLongTaskMs(0);

    try {
      if (typeof PerformanceObserver === "undefined") return;
      const obs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const e of entries) {
          longTaskMsRef.current += Math.round(e.duration || 0);
        }
        setLongTaskMs(longTaskMsRef.current);
      });
      obs.observe({ entryTypes: ["longtask"] });
      perfObsRef.current = obs;
    } catch {
      // ignore
    }
  }

  function stopPerfObserver() {
    try {
      perfObsRef.current?.disconnect?.();
    } catch {
      // ignore
    }
    perfObsRef.current = null;
  }

  function clearProgressTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  const reliability = useMemo(() => {
    return reliabilityScore({
      externalChecksEnabled,
      networkHintSupported: netHint.supported,
      longTaskSupported,
    });
  }, [externalChecksEnabled, netHint.supported, longTaskSupported]);

  const latestResult = after || baseline;

  const health = useMemo(() => {
    const latencyMs = latestResult?.latency?.bestMs ?? null;
    const dnsOk = latestResult?.dns?.ok ?? null;
    const captiveLikely = latestResult?.captive?.suspected ?? false;

    return classifyHealth({
      online: scanMeta.online,
      externalChecksEnabled,
      latencyMs,
      dnsOk,
      captiveLikely,
    });
  }, [latestResult, scanMeta.online, externalChecksEnabled]);

  const HealthIcon = health.icon;

  const deltas = useMemo(() => {
    if (!baseline || !after) return { latencyDelta: null, dnsChanged: null, captiveChanged: null };
    const latencyDelta =
      baseline.latency?.bestMs != null && after.latency?.bestMs != null ? after.latency.bestMs - baseline.latency.bestMs : null;
    const dnsChanged = baseline.dns?.ok != null && after.dns?.ok != null ? after.dns.ok !== baseline.dns.ok : null;
    const captiveChanged =
      baseline.captive?.suspected != null && after.captive?.suspected != null ? after.captive.suspected !== baseline.captive.suspected : null;
    return { latencyDelta, dnsChanged, captiveChanged };
  }, [baseline, after]);

  const autoSuggestion = useMemo(() => {
    return buildAutoSuggestion({
      externalChecksEnabled,
      latestResult,
      abDeltaMs: deltas.latencyDelta,
    });
  }, [externalChecksEnabled, latestResult, deltas.latencyDelta]);

  async function runOneScan(label = "scan") {
    const online = typeof navigator.onLine === "boolean" ? navigator.onLine : true;
    const networkHint = getNetworkHint();

    // Privacy mode output
    if (!externalChecksEnabled) {
      return {
        label,
        timestamp: new Date().toISOString(),
        online,
        networkHint,
        latency: {
          google204: null,
          cfTrace: null,
          cfHome: null,
          bestMs: null,
          worstMs: null,
          note: "External diagnostics are disabled.",
        },
        captive: { suspected: null, note: "Disabled (Privacy Mode)." },
        dns: { ok: null, note: "Disabled (Privacy Mode)." },
        doh: null,
      };
    }

    // 3 probes: google204 + cloudflare trace + cloudflare homepage
    const [g204, cfTrace, cfHome] = await Promise.all([
      timedFetch(ENDPOINTS.google204, 2500),
      timedFetch(ENDPOINTS.cfTrace, 2500),
      timedFetch(ENDPOINTS.cfHome, 2500),
    ]);

    const samples = [g204?.ms, cfTrace?.ms, cfHome?.ms].filter((v) => typeof v === "number");
    const bestMs = samples.length ? Math.min(...samples) : null;
    const worstMs = samples.length ? Math.max(...samples) : null;

    // Captive portal best-effort: if online and some probe works, but gstatic204 is very slow/errors
    const captiveProbe = await timedFetch(ENDPOINTS.gstatic204, 2500);
    const transportOk = [g204, cfTrace, cfHome].some((p) => p?.ok);
    const captiveSuspected = online && transportOk && (captiveProbe.ok === false || captiveProbe.ms >= 1800);

    // DNS heuristic:
    // - Domain evidence: google204 or cloudflare.com succeeded
    // - Transport evidence: any probe completed
    const domainOk = Boolean(g204?.ok || cfHome?.ok);
    const dnsLikelyBroken = transportOk && !domainOk;

    // DoH best-effort (may be opaque/blocked)
    const doh = await timedFetch(ENDPOINTS.dohCloudflare, 2500, { Accept: "application/dns-json" });

    const dnsOk = !dnsLikelyBroken;
    const dnsNote = dnsLikelyBroken
      ? "Transport reachable but domains fail — DNS/APN/VPN/Private DNS likely."
      : doh.ok
        ? "DNS resolution appears OK (best effort)."
        : "DNS looks OK, but DoH probe was inconclusive (blocked/opaque).";

    return {
      label,
      timestamp: new Date().toISOString(),
      online,
      networkHint,
      latency: {
        google204: g204,
        cfTrace,
        cfHome,
        bestMs,
        worstMs,
        note:
          bestMs != null && bestMs >= 900
            ? "Very high latency — likely congestion or stalled session."
            : bestMs != null && bestMs >= 450
              ? "Elevated latency — possible congestion."
              : "Latency looks normal.",
      },
      captive: {
        suspected: captiveSuspected,
        note: captiveSuspected ? "Possible Wi-Fi login intercept detected." : "No strong captive portal signals.",
      },
      dns: { ok: dnsOk, note: dnsNote },
      doh,
    };
  }

  async function runScanFlow() {
    if (stage === "scanning") return;

    setStage("scanning");
    setProgress(0);

    setScanMeta({
      timestamp: new Date().toISOString(),
      online: typeof navigator.onLine === "boolean" ? navigator.onLine : true,
      networkHint: getNetworkHint(),
    });

    const steps = ["Initializing", "Testing latency", "Checking captive portal", "Verifying DNS", "Compiling diagnosis"];

    clearProgressTimer();
    timerRef.current = setInterval(() => setProgress((p) => clamp(p + 1, 0, steps.length)), 950);

    startPerfObserver();

    try {
      const base = await runOneScan("Baseline");
      setBaseline(base);
      setAfter(null);

      // Keep UI progress alive for a moment (UX)
      await new Promise((r) => setTimeout(r, 1200));

      clearProgressTimer();
      setProgress(steps.length);
      stopPerfObserver();

      if (abModeEnabled && externalChecksEnabled) {
        setAbPhase("baselineDone");
      } else {
        setAbPhase("none");
      }

      setStage("done");
    } catch {
      clearProgressTimer();
      stopPerfObserver();
      setStage("done");
    }
  }

  async function runAfterFixFlow() {
    if (stage === "scanning") return;
    if (!abModeEnabled || !externalChecksEnabled) return;

    setStage("scanning");
    setProgress(0);

    const steps = ["Re-checking", "Testing latency", "Checking captive portal", "Verifying DNS", "Comparing results"];

    clearProgressTimer();
    timerRef.current = setInterval(() => setProgress((p) => clamp(p + 1, 0, steps.length)), 950);

    startPerfObserver();

    try {
      const aft = await runOneScan("After Reset");
      setAfter(aft);

      await new Promise((r) => setTimeout(r, 900));

      clearProgressTimer();
      setProgress(steps.length);
      stopPerfObserver();

      setAbPhase("afterDone");
      setStage("done");
    } catch {
      clearProgressTimer();
      stopPerfObserver();
      setStage("done");
    }
  }

  const scanStepsLabel =
    stage === "scanning"
      ? ["Initializing", "Testing latency", "Checking captive portal", "Verifying DNS", "Compiling diagnosis"][Math.max(0, Math.min(4, progress - 1))] ||
        "Starting"
      : "Ready";

  const showAfterButton = abModeEnabled && externalChecksEnabled && abPhase === "baselineDone";

  const statusCardTone =
    health.level === "green"
      ? "from-emerald-500/10 via-emerald-500/5 to-transparent"
      : health.level === "amber"
        ? "from-amber-500/12 via-amber-500/6 to-transparent"
        : "from-rose-500/12 via-rose-500/6 to-transparent";

  const statusRing = health.level === "green" ? "ring-emerald-500/30" : health.level === "amber" ? "ring-amber-500/30" : "ring-rose-500/30";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 opacity-[0.10]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.6)_1px,transparent_0)] [background-size:18px_18px]" />
      </div>

      <div className="relative mx-auto w-full max-w-md px-4 pb-10 pt-6">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-2xl bg-white/5 p-2 ring-1 ring-white/10">
                <Network className="h-5 w-5 text-zinc-200" />
              </div>
              <div>
                <div className="text-lg font-extrabold tracking-tight">{BRAND.name}</div>
                <div className="text-xs text-zinc-400">{BRAND.tagline}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge level={health.level} label={health.label} />
            <ReliabilityBadge level={reliability.level} label={reliability.label} />
            <div className="text-[11px] text-zinc-500">Works with mobile carriers worldwide</div>
          </div>
        </div>

        {/* Reliability note */}
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-zinc-400 ring-1 ring-white/10">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 text-zinc-300" />
            <div>
              <div className="font-semibold text-zinc-200">Reliability</div>
              <div className="mt-1 leading-relaxed">{reliability.note}</div>
            </div>
          </div>
        </div>

        {/* Privacy / controls */}
        <div className="mb-4 space-y-3">
          <Toggle
            enabled={externalChecksEnabled}
            onChange={(v) => {
              setExternalChecksEnabled(v);
              setAbPhase("none");
              setBaseline(null);
              setAfter(null);
            }}
            label="Enable External Diagnostics"
            hint="OFF by default. When enabled, your browser makes outbound HTTPS requests to public endpoints for connectivity checks. This app stores nothing."
            icon={Lock}
          />

          <Toggle
            enabled={abModeEnabled}
            onChange={(v) => {
              setAbModeEnabled(v);
              setAbPhase("none");
              setAfter(null);
            }}
            label="A/B Scan Mode (Before/After Airplane Mode)"
            hint="Baseline scan, then re-scan after airplane mode. Helps detect stalled data sessions without accessing sensitive device data."
            icon={Layers}
          />

          <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-3 text-xs text-zinc-400 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 text-zinc-300" />
              <div>
                <div className="font-semibold text-zinc-200">PDPA Notice (Plain-English)</div>
                <div className="mt-1 leading-relaxed">
                  This app runs on your device. It does not create accounts or collect identifiers. If you enable External Diagnostics, your device will send normal web
                  requests to public endpoints; those services may log network metadata (IP/user-agent) as per their policies.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-zinc-300 ring-1 ring-white/10">
            <div className="flex items-start gap-2">
              <Wifi className="mt-0.5 h-4 w-4 text-zinc-200" />
              <div>
                <div className="font-semibold text-zinc-100">For mobile data testing</div>
                <div className="mt-1 text-zinc-400">
                  Turn <span className="text-zinc-200">Wi-Fi OFF</span> before scanning. Captive Wi-Fi often mimics “no data” symptoms.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* System Health */}
        <div
          className={`mb-4 rounded-3xl border border-white/10 bg-gradient-to-br ${statusCardTone} p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ring-1 ${statusRing}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold tracking-wide text-zinc-400">SYSTEM HEALTH</div>
              <div className="mt-1 text-2xl font-black tracking-tight">{health.title}</div>
              <div className="mt-2 text-sm leading-relaxed text-zinc-300">{health.detail}</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
              <HealthIcon className="h-6 w-6" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="text-[11px] text-zinc-500">Best Latency</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg font-extrabold">{latestResult?.latency?.bestMs ?? "—"}</span>
                <span className="text-xs text-zinc-500">ms</span>
              </div>
            </div>
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="text-[11px] text-zinc-500">DNS</div>
              <div className="mt-1 text-lg font-extrabold">{latestResult?.dns?.ok == null ? "—" : latestResult.dns.ok ? "OK" : "BAD"}</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="text-[11px] text-zinc-500">Captive</div>
              <div className="mt-1 text-lg font-extrabold">
                {latestResult?.captive?.suspected == null ? "—" : latestResult.captive.suspected ? "YES" : "NO"}
              </div>
            </div>
          </div>

          {stage === "scanning" ? (
            <div className="mt-4">
              <ProgressPill step={progress} total={5} label={scanStepsLabel} />
            </div>
          ) : null}
        </div>

        {/* Primary actions */}
        <div className="mb-4 space-y-3">
          <button
            onClick={runScanFlow}
            className="w-full rounded-2xl bg-white text-zinc-950 shadow-lg shadow-white/10 ring-1 ring-white/20 active:scale-[0.99]"
          >
            <div className="flex items-center justify-center gap-3 px-4 py-4">
              {stage === "scanning" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wrench className="h-5 w-5" />}
              <div className="text-base font-extrabold tracking-tight">{stage === "scanning" ? "Running Scan…" : "Run Scan"}</div>
            </div>
          </button>

          {!externalChecksEnabled ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 ring-1 ring-amber-500/20">
              <div className="flex items-start gap-2">
                <Lock className="mt-0.5 h-4 w-4" />
                <div>
                  <div className="font-semibold">Limited Mode</div>
                  <div className="mt-1 text-amber-100/80">Enable External Diagnostics above for latency/DNS/captive checks.</div>
                </div>
              </div>
            </div>
          ) : null}

          {showAfterButton ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 ring-1 ring-white/10">
              <div className="mb-2 text-sm font-semibold text-zinc-100">A/B Step 2 — After Airplane Mode</div>
              <div className="text-xs text-zinc-400">
                Toggle airplane mode for <span className="text-zinc-200">10 seconds</span>, then tap “Re-Scan After Reset”.
              </div>
              <button onClick={runAfterFixFlow} className="mt-3 w-full rounded-2xl bg-zinc-100 text-zinc-950 ring-1 ring-white/20 active:scale-[0.99]">
                <div className="flex items-center justify-center gap-3 px-4 py-3">
                  <Layers className="h-5 w-5" />
                  <div className="text-sm font-extrabold tracking-tight">Re-Scan After Reset</div>
                </div>
              </button>
            </div>
          ) : null}
        </div>

        {/* Results */}
        <div className="space-y-4">
          <Card
            title="A/B Comparison"
            icon={Layers}
            help="Shows whether airplane mode reset improved things. Big improvement often means a stalled data session."
            right={baseline && after ? <span className="text-xs text-zinc-400">delta view</span> : null}
          >
            {!baseline ? (
              <div className="text-sm text-zinc-400">Run a scan to generate a baseline.</div>
            ) : (
              <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[11px] text-zinc-500">Baseline</div>
                    <div className="mt-1 text-sm font-bold text-zinc-100">{baseline.latency?.bestMs != null ? `${baseline.latency.bestMs} ms` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500">After Reset</div>
                    <div className="mt-1 text-sm font-bold text-zinc-100">{after?.latency?.bestMs != null ? `${after.latency.bestMs} ms` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500">Δ Latency</div>
                    <div
                      className={`mt-1 text-sm font-black ${
                        deltas.latencyDelta == null
                          ? "text-zinc-100"
                          : deltas.latencyDelta <= -250
                            ? "text-emerald-300"
                            : deltas.latencyDelta >= 250
                              ? "text-rose-200"
                              : "text-amber-200"
                      }`}
                    >
                      {formatDeltaMs(deltas.latencyDelta)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-400">
                  <div className="rounded-xl bg-white/5 p-2 ring-1 ring-white/10">
                    <div className="font-semibold text-zinc-200">DNS changed</div>
                    <div className="mt-1">{deltas.dnsChanged == null ? "—" : deltas.dnsChanged ? "Yes" : "No"}</div>
                  </div>
                  <div className="rounded-xl bg-white/5 p-2 ring-1 ring-white/10">
                    <div className="font-semibold text-zinc-200">Captive changed</div>
                    <div className="mt-1">{deltas.captiveChanged == null ? "—" : deltas.captiveChanged ? "Yes" : "No"}</div>
                  </div>
                </div>

                <div className="mt-3 text-xs text-zinc-400">
                  Tip: Big improvement after reset → likely a <span className="text-zinc-200">stalled session</span>. No improvement → likely{" "}
                  <span className="text-zinc-200">congestion/coverage</span>.
                </div>
              </div>
            )}
          </Card>

          {/* Latency (Ping) */}
          <Card
            title="Latency (Ping)"
            icon={Timer}
            help="Measures how long it takes to reach the internet (timed fetch; browsers can’t do true ICMP ping)."
            right={<span className="text-xs text-zinc-400">best of 3 probes</span>}
          >
            {(() => {
              const latency = latestResult?.latency;

              const getOpaque = (p) => {
                if (!p) return false;
                // support either shape: { opaque: true } OR { type: 'opaque' }
                return Boolean(p.opaque ?? (typeof p.type === "string" && p.type === "opaque"));
              };

              const probeSub = (p) => {
                if (!p) return externalChecksEnabled ? "Not tested" : "Disabled (Privacy Mode)";
                if (p.ok) return getOpaque(p) ? "Probe completed (opaque response)" : "Probe completed";
                return `Failed (${p.error || "Error"})`;
              };

              const probeStatus = (p) => {
                if (!p) return externalChecksEnabled ? "neutral" : "warn";
                if (!p.ok) return "bad";
                if (typeof p.ms !== "number") return "neutral";
                if (p.ms >= 900) return "bad";
                if (p.ms >= 450) return "warn";
                return "good";
              };

              const probeValue = (p) => (p && typeof p.ms === "number" ? `${p.ms} ms` : "—");

              return (
                <div className="space-y-3">
                  <MetricRow
                    icon={Globe}
                    label="google.com (204 probe)"
                    value={probeValue(latency?.google204)}
                    sub={probeSub(latency?.google204)}
                    status={probeStatus(latency?.google204)}
                  />

                  <MetricRow
                    icon={Network}
                    label="Cloudflare (secondary probe)"
                    value={probeValue(latency?.cfTrace)}
                    sub={probeSub(latency?.cfTrace)}
                   status={probeStatus(latency?.cfTrace)}
                  />

                  <MetricRow
                    icon={Globe}
                    label="cloudflare.com (domain probe)"
                    value={probeValue(latency?.cfHome)}
                    sub={probeSub(latency?.cfHome)}
                    status={probeStatus(latency?.cfHome)}
                  />

                  <div className="rounded-2xl bg-white/5 p-3 text-xs text-zinc-400 ring-1 ring-white/10">
                    <div className="flex items-start gap-2">
                      <CircleHelp className="mt-0.5 h-4 w-4 text-zinc-300" />
                      <div>
                        Browsers can’t do true ICMP ping — these are timed HTTPS probes.{" "}
                        <span className="text-zinc-200">“Opaque response” is normal</span>. If one probe fails
                        (e.g., TypeError) but others succeed, your internet is likely OK and that endpoint is
                        blocked/filtered.
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </Card>

          {/* Diagnosis + Auto suggestion */}
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 ring-1 ring-white/10">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-wide text-zinc-400">DIAGNOSIS</div>
                <div className="mt-1 text-xl font-black tracking-tight">{health.title}</div>
                <div className="mt-2 text-sm leading-relaxed text-zinc-300">{health.detail}</div>

                {autoSuggestion ? (
                  <div className="mt-3 rounded-xl bg-white/5 p-3 text-xs text-zinc-300 ring-1 ring-white/10">
                    <div className="font-semibold text-zinc-200">Auto suggestion</div>
                    <div className="mt-1 text-zinc-400">{autoSuggestion}</div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <Activity className="h-6 w-6" />
              </div>
            </div>
          </div>

          {/* Quick Fix */}
          <div className="rounded-3xl border border-white/10 bg-zinc-950/60 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-xl bg-white/5 p-2 text-zinc-200">
                <Wrench className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold text-zinc-100">Quick Fix</div>
            </div>

            <ol className="space-y-2 text-sm text-zinc-300">
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-lg bg-white/5 text-xs font-bold text-zinc-200 ring-1 ring-white/10">
                  1
                </span>
                <span>Toggle Airplane Mode (10 seconds), then re-scan.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-lg bg-white/5 text-xs font-bold text-zinc-200 ring-1 ring-white/10">
                  2
                </span>
                <span>
                  Disable VPN / Private DNS / Data Saver, then re-scan. (If SIMBA: set APN to <b>tpg</b>.)
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-lg bg-white/5 text-xs font-bold text-zinc-200 ring-1 ring-white/10">
                  3
                </span>
                <span>Reset Network Settings (last resort).</span>
              </li>
            </ol>
          </div>

          {/* Deploy notes */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-zinc-400 ring-1 ring-white/10">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 text-zinc-300" />
              <div>
                <div className="font-semibold text-zinc-200">Security Deploy Notes</div>
                <div className="mt-1 leading-relaxed">
                  Deploy with a strict Content Security Policy (CSP) and allowlist only required endpoints via{" "}
                  <span className="text-zinc-200">connect-src</span>. If External Diagnostics is OFF, set{" "}
                  <span className="text-zinc-200">connect-src 'self'</span>.
                </div>
              </div>
            </div>
          </div>

          <div className="pb-2 pt-1 text-center text-xs text-zinc-500">Pro-tip: Run scan with Wi-Fi OFF to test true mobile data.</div>
        </div>
      </div>
    </div>
  );
}