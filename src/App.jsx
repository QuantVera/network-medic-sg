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
 * Network Medic — single-page mobile-web app (React + Tailwind)
 *
 * Privacy posture (default):
 * - No accounts, no analytics, no tracking.
 * - No data is sent to any server controlled by the app (client-only).
 * - External diagnostic checks are OPTIONAL and OFF by default.
 * - When enabled, the app will make outbound HTTPS requests to public endpoints
 *   (e.g., Google/Cloudflare) purely to infer connectivity.
 *
 * Security posture:
 * - No 3rd-party scripts.
 * - No persistent storage.
 * - Recommend strict CSP + connect-src allowlist at deploy time.
 */

const BRAND = {
  name: "Network Medic",
  tagline: "Signal bars but no internet? Let’s diagnose your connection.",
};

const ENDPOINTS = {
  google204: "https://www.google.com/generate_204",
  gstatic204: "https://www.gstatic.com/generate_204",

  // Use DOMAIN instead of raw IP: far fewer mobile carrier blocks
  cfTrace: "https://one.one.one.one/cdn-cgi/trace",
  cfHome: "https://www.cloudflare.com/",

  // DoH (best-effort; may be blocked)
  dohCloudflare: "https://cloudflare-dns.com/dns-query?name=example.com&type=A",
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/**
 * Best-effort fetch timing probe.
 * Note: With `mode: "no-cors"`, most responses are opaque and status is usually 0.
 * We treat "fetch resolved" as "probe completed", NOT as a guaranteed successful HTTP response.
 */
async function timedFetch(url, timeoutMs = 2500, extraHeaders = {}) {
  const controller = new AbortController();
  const start = performance.now();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
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

    const ms = Math.round(performance.now() - start);
    const type = res?.type || "opaque";

    return {
      ok: true, // means request did not throw
      status: typeof res?.status === "number" ? res.status : 0,
      type,
      opaque: type === "opaque",
      ms,
    };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    return {
      ok: false,
      status: 0,
      type: "error",
      opaque: false,
      ms,
      error: e?.name || "FetchError",
    };
  } finally {
    clearTimeout(id);
  }
}

function classifyHealth({
  online,
  externalChecksEnabled,
  latencyMs,
  dnsOk,
  captiveLikely,
}) {
  if (!online) {
    return {
      level: "red",
      title: "No Connectivity",
      detail: "Device appears offline (or network blocks connectivity).",
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
      detail: "You may be stuck on a ‘Login required’ Wi-Fi page.",
      label: "LOGIN REQUIRED",
      icon: ShieldAlert,
    };
  }

  if (latencyMs >= 900) {
    return {
      level: "amber",
      title: "Stalled Connection",
      detail:
        "Latency is extremely high — congestion or a stuck radio session is likely.",
      label: "CONGESTION / STALL",
      icon: Activity,
    };
  }

  if (!dnsOk) {
    return {
      level: latencyMs >= 900 ? "red" : "amber",
      title: "DNS Issues",
      detail: "Domain resolution appears broken (often APN/DNS/VPN settings).",
      label: "DNS DEGRADED",
      icon: Globe,
    };
  }

  return {
    level: "green",
    title: "Healthy",
    detail: "Data path looks OK (best-effort browser checks).",
    label: "OK",
    icon: BadgeCheck,
  };
}

function getNetworkHint() {
  const conn =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  if (!conn) {
    return {
      supported: false,
      effectiveType: "unknown",
      downlink: null,
      rtt: null,
      saveData: null,
    };
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

function reliabilityScore({
  externalChecksEnabled,
  networkHintSupported,
  longTaskSupported,
}) {
  if (!externalChecksEnabled) {
    return {
      level: "low",
      label: "Low",
      note:
        "Privacy Mode is ON — external checks are disabled, so diagnosis is guidance-only.",
    };
  }

  const extras = (networkHintSupported ? 1 : 0) + (longTaskSupported ? 1 : 0);

  if (extras >= 2) {
    return {
      level: "high",
      label: "High",
      note:
        "External probes + device signals available (best accuracy this browser can offer).",
    };
  }

  if (extras === 1) {
    return {
      level: "medium",
      label: "Medium",
      note:
        "External probes are available, but some device/network APIs are not supported.",
    };
  }

  return {
    level: "medium",
    label: "Medium",
    note:
      "External probes are available. Device/network hints are limited on this browser.",
  };
}

function detectCarrierHint() {
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
  simba: {
    name: "SIMBA (TPG)",
    apn: "tpg",
    notes:
      "If you have bars but no data, SIMBA often needs APN set to ‘tpg’.",
  },
  singtel: {
    name: "Singtel",
    apn: "(auto) e-ideas",
    notes:
      "Usually auto-configures APN. If issues persist, reset network settings.",
  },
  starhub: {
    name: "StarHub",
    apn: "(auto) shwap",
    notes:
      "Typically auto-configures. Verify mobile data is enabled and plan not throttled.",
  },
  m1: {
    name: "M1",
    apn: "(auto) sunsurf",
    notes:
      "Typically auto-configures. If DNS seems broken, toggle airplane mode and retry.",
  },
  unknown: {
    name: "Unknown Carrier",
    apn: "(check carrier docs)",
    notes:
      "Carrier detection isn’t reliable in browsers. Select your carrier below for APN guidance.",
  },
};

function Badge({ level, label }) {
  const styles =
    level === "green"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"
      : level === "amber"
        ? "bg-amber-500/15 text-amber-200 ring-amber-500/25"
        : "bg-rose-500/15 text-rose-200 ring-rose-500/25";

  const dot =
    level === "green"
      ? "bg-emerald-300"
      : level === "amber"
        ? "bg-amber-200"
        : "bg-rose-200";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide ring-1 ${styles}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
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

  const dot =
    level === "high"
      ? "bg-emerald-300"
      : level === "medium"
        ? "bg-amber-200"
        : "bg-zinc-200";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide ring-1 ${styles}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      Reliability: {label}
    </span>
  );
}

function MetricRow({ icon: Icon, label, value, sub, status }) {
  const tint =
    status === "good"
      ? "text-emerald-300"
      : status === "warn"
        ? "text-amber-200"
        : status === "bad"
          ? "text-rose-200"
          : "text-zinc-300";

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
        <div
          className="h-full rounded-full bg-white/20"
          style={{ width: `${clamp(pct, 0, 100)}%` }}
        />
      </div>
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
          enabled
            ? "bg-emerald-500/30 ring-emerald-500/30"
            : "bg-white/10 ring-white/15"
        }`}
        aria-pressed={enabled}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-zinc-950 ring-1 ring-white/20 transition ${
            enabled ? "left-5" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function formatDeltaMs(delta) {
  if (delta == null) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ms`;
}

function scoreDiagnosis({ externalChecksEnabled, baseline, after, longTaskMs }) {
  if (!externalChecksEnabled) {
    return {
      label: "Limited Scan",
      reason: "External diagnostics are OFF. Enable them for deeper checks.",
      bullets: ["No external probes performed.", "No data stored by this app."],
    };
  }

  const latest = after || baseline;
  if (!latest) {
    return { label: "Ready", reason: "Run a scan to generate results.", bullets: [] };
  }

  const latencyMs = latest.latency.bestMs ?? 9999;
  const bullets = [];

  if (longTaskMs >= 1500) {
    bullets.push("Device seems busy — close heavy apps and retry.");
  }

  if (latest.captive.suspected) {
    return {
      label: "Captive Portal",
      reason:
        "You may be on Wi-Fi that requires login. Turn off Wi-Fi or complete sign-in.",
      bullets: [
        "Open browser to sign in (public Wi-Fi).",
        "Disable Wi-Fi to test mobile data.",
        ...bullets,
      ],
    };
  }

  if (latest.dns.ok === false) {
    return {
      label: "DNS / APN Issue",
      reason:
        "Domains appear broken — often APN/VPN/Private DNS misconfiguration.",
      bullets: [
        "Check APN (SIMBA often requires APN: tpg).",
        "Disable VPN / Private DNS and retry.",
        ...bullets,
      ],
    };
  }

  if (baseline && after && baseline.latency.bestMs != null && after.latency.bestMs != null) {
    const delta = after.latency.bestMs - baseline.latency.bestMs;
    const improved = delta <= -250;
    const worsened = delta >= 250;

    if (improved && baseline.latency.bestMs >= 600) {
      return {
        label: "Stalled Radio Session",
        reason:
          "After airplane mode, latency improved a lot — often a stuck data session.",
        bullets: [
          "If frequent: reboot phone or re-seat SIM.",
          "If location-specific: tower handover/congestion.",
          ...bullets,
        ],
      };
    }

    if (worsened && after.latency.bestMs >= 900) {
      return {
        label: "Congestion / Coverage",
        reason:
          "Latency worsened and is very high — likely congestion, weak coverage, or throttling.",
        bullets: ["Move to open area / near window.", "Try 4G-only mode temporarily.", ...bullets],
      };
    }
  }

  if (latencyMs >= 900) {
    return {
      label: "Radio Congestion",
      reason:
        "Latency is extremely high. Congestion or a stalled session is likely.",
      bullets: ["Toggle airplane mode then re-run.", "Retry later (peak-time congestion).", ...bullets],
    };
  }

  if (latencyMs >= 450) {
    return {
      label: "Degraded",
      reason:
        "Latency is elevated — indoor dead spot, congestion, or throttling.",
      bullets: ["Re-test with Wi-Fi OFF.", "Try a different location/time.", ...bullets],
    };
  }

  return {
    label: "Healthy",
    reason: "Connectivity looks normal based on browser-safe diagnostics.",
    bullets: ["If apps still fail, check VPN/Private DNS/data saver modes.", ...bullets],
  };
}

export default function NetworkMedic() {
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState(0);

  const [externalChecksEnabled, setExternalChecksEnabled] = useState(false);

  const [abModeEnabled, setAbModeEnabled] = useState(true);
  const [abPhase, setAbPhase] = useState("none");

  const [carrier, setCarrier] = useState(() => detectCarrierHint());

  const [baseline, setBaseline] = useState(null);
  const [after, setAfter] = useState(null);

  const [longTaskMs, setLongTaskMs] = useState(0);
  const longTaskMsRef = useRef(0);
  const perfObsRef = useRef(null);

  const [scanMeta, setScanMeta] = useState({
    timestamp: null,
    online: typeof navigator.onLine === "boolean" ? navigator.onLine : true,
    networkHint: getNetworkHint(),
  });

  const timerRef = useRef(null);

  useEffect(() => {
    const onOnline = () =>
      setScanMeta((s) => ({
        ...s,
        online: typeof navigator.onLine === "boolean" ? navigator.onLine : true,
      }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);

  // Cleanup if user navigates away mid-scan
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        perfObsRef.current?.disconnect?.();
      } catch {
        // ignore
      }
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

  const carrierInfo = CARRIER_APN[carrier] || CARRIER_APN.unknown;
  const latestResult = after || baseline;

  const netHint = scanMeta.networkHint;
  const longTaskSupported = supportsLongTask();

  const reliability = useMemo(
    () =>
      reliabilityScore({
        externalChecksEnabled,
        networkHintSupported: netHint.supported,
        longTaskSupported,
      }),
    [externalChecksEnabled, netHint.supported, longTaskSupported]
  );

  const health = useMemo(() => {
    const latencyMs = latestResult?.latency?.bestMs ?? 9999;
    const dnsOk = latestResult?.dns?.ok ?? true;
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

  const diagnosis = useMemo(
    () => scoreDiagnosis({ externalChecksEnabled, baseline, after, longTaskMs }),
    [externalChecksEnabled, baseline, after, longTaskMs]
  );

  const deltas = useMemo(() => {
    if (!baseline || !after) {
      return { latencyDelta: null, dnsChanged: null, captiveChanged: null };
    }

    const latencyDelta =
      baseline.latency.bestMs != null && after.latency.bestMs != null
        ? after.latency.bestMs - baseline.latency.bestMs
        : null;

    const dnsChanged =
      baseline.dns.ok != null && after.dns.ok != null
        ? after.dns.ok !== baseline.dns.ok
        : null;

    const captiveChanged =
      baseline.captive.suspected != null && after.captive.suspected != null
        ? after.captive.suspected !== baseline.captive.suspected
        : null;

    return { latencyDelta, dnsChanged, captiveChanged };
  }, [baseline, after]);

  async function runOneScan(label = "scan") {
    const online = typeof navigator.onLine === "boolean" ? navigator.onLine : true;
    const networkHint = getNetworkHint();

    if (!externalChecksEnabled) {
      return {
        label,
        timestamp: new Date().toISOString(),
        online,
        networkHint,
        latency: {
          google204: null,
          cloudflare: null,
          bestMs: null,
          worstMs: null,
          note: "Privacy Mode is ON: external probes are disabled.",
        },
        captive: {
          suspected: null,
          note: "Privacy Mode is ON: captive portal check is disabled.",
        },
        dns: {
          ok: null,
          note: "Privacy Mode is ON: DNS check is disabled.",
        },
      };
    }

    // Latency probes (best-effort)
    const [g204, cfTrace, cfHome] = await Promise.all([
  timedFetch(ENDPOINTS.google204, 2500),
  timedFetch(ENDPOINTS.cfTrace, 2500),
  timedFetch(ENDPOINTS.cfHome, 2500),
]);

const latencies = [g204, cfTrace, cfHome]
  .filter((x) => x && typeof x.ms === "number")
  .map((x) => x.ms);

const bestMs = latencies.length ? Math.min(...latencies) : null;
const worstMs = latencies.length ? Math.max(...latencies) : null;

    const bestMs = Math.min(g204.ms, cf.ms);
    const worstMs = Math.max(g204.ms, cf.ms);

    // Captive portal probe (best-effort)
    const captiveProbe = await timedFetch(ENDPOINTS.gstatic204, 2500);

    // If online and one probe completes but captive probe is very slow or errors, suspect captive
    const captiveSuspected =
      online &&
      (captiveProbe.ok === false || captiveProbe.ms >= 1800) &&
      (g204.ok || cf.ok);

    // DNS heuristic: if name probe errors but IP-ish probe completes, suspect DNS/APN/VPN/Private DNS
    // Transport looks OK if ANY probe worked
const transportOk = [g204, cfTrace, cfHome].some((p) => p?.ok);

// Domain reachability evidence (2 domains)
const domainOk = g204?.ok || cfHome?.ok;

// DNS is suspected only when transport OK but domains not OK
const dnsLikelyBroken = transportOk && !domainOk;

    // DoH best-effort (often opaque/blocked)
    const doh = await timedFetch(ENDPOINTS.dohCloudflare, 2500, {
      Accept: "application/dns-json",
    });

    const dnsOk = !dnsLikelyBroken;
    const dnsNote = dnsLikelyBroken
      ? "Transport seems reachable but domains fail — DNS/APN/VPN/Private DNS likely."
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
        cloudflare: cfTrace,
        cfHome, 
        bestMs,
        worstMs,
        note:
          bestMs >= 900
            ? "Very high latency — likely congestion or stalled session."
            : bestMs >= 450
              ? "Elevated latency — possible congestion."
              : "Latency looks normal.",
      },
      captive: {
        suspected: captiveSuspected,
        note: captiveSuspected
          ? "Possible Wi-Fi login intercept detected."
          : "No strong captive portal signals.",
      },
      dns: {
        ok: dnsOk,
        note: dnsNote,
      },
      doh,
    };
  }

  async function runScanFlow() {
    if (stage === "scanning") return;

    const steps = [
      "Initializing",
      "Testing latency",
      "Checking captive portal",
      "Verifying DNS",
      "Compiling diagnosis",
    ];

    setStage("scanning");
    setProgress(0);

    setScanMeta({
      timestamp: new Date().toISOString(),
      online: typeof navigator.onLine === "boolean" ? navigator.onLine : true,
      networkHint: getNetworkHint(),
    });

    const progressTick = () =>
      setProgress((p) => clamp(p + 1, 0, steps.length));

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(progressTick, 950);

    startPerfObserver();

    try {
      const base = await runOneScan("Baseline");
      setBaseline(base);
      setAfter(null);

      // Simulated diagnostic sequence (UX)
      await new Promise((r) => setTimeout(r, 5200));

      setProgress(steps.length);

      if (abModeEnabled && externalChecksEnabled) setAbPhase("baselineDone");
      else setAbPhase("none");

      setStage("done");
    } catch {
      setStage("done");
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopPerfObserver();
    }
  }

  async function runAfterFixFlow() {
    if (stage === "scanning") return;
    if (!abModeEnabled || !externalChecksEnabled) return;

    const steps = [
      "Re-checking",
      "Testing latency",
      "Checking captive portal",
      "Verifying DNS",
      "Comparing results",
    ];

    setStage("scanning");
    setProgress(0);

    const progressTick = () =>
      setProgress((p) => clamp(p + 1, 0, steps.length));

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(progressTick, 950);

    startPerfObserver();

    try {
      const aft = await runOneScan("After Reset");
      setAfter(aft);

      // Simulated diagnostic sequence (UX)
      await new Promise((r) => setTimeout(r, 5200));

      setProgress(steps.length);
      setAbPhase("afterDone");
      setStage("done");
    } catch {
      setStage("done");
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopPerfObserver();
    }
  }

  const statusCardTone =
    health.level === "green"
      ? "from-emerald-500/10 via-emerald-500/5 to-transparent"
      : health.level === "amber"
        ? "from-amber-500/12 via-amber-500/6 to-transparent"
        : "from-rose-500/12 via-rose-500/6 to-transparent";

  const statusRing =
    health.level === "green"
      ? "ring-emerald-500/30"
      : health.level === "amber"
        ? "ring-amber-500/30"
        : "ring-rose-500/30";

  const scanStepsLabel =
    stage === "scanning"
      ? ([
          "Initializing",
          "Testing latency",
          "Checking captive portal",
          "Verifying DNS",
          "Compiling diagnosis",
        ][Math.max(0, Math.min(4, progress - 1))] || "Starting")
      : "Ready";

  const showAfterButton =
    abModeEnabled && externalChecksEnabled && abPhase === "baselineDone";

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
                <div className="text-lg font-extrabold tracking-tight">
                  {BRAND.name}
                </div>
                <div className="text-xs text-zinc-400">{BRAND.tagline}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge level={health.level} label={health.label} />
            <ReliabilityBadge level={reliability.level} label={reliability.label} />
            <div className="text-[11px] text-zinc-500">
              Works with all mobile carriers worldwide
            </div>
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
            hint="Baseline scan, then re-scan after airplane mode. Helps detect ‘stalled session’ issues without accessing sensitive device data."
            icon={Layers}
          />

          <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-3 text-xs text-zinc-400 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 text-zinc-300" />
              <div>
                <div className="font-semibold text-zinc-200">
                  PDPA Notice (Plain-English)
                </div>
                <div className="mt-1 leading-relaxed">
                  This app runs entirely on your device. It does not create
                  accounts, collect names, phone numbers, location, or
                  identifiers. If you enable External Diagnostics, your device
                  will send normal web requests to public endpoints; those
                  services may log network metadata (IP/user-agent) as per their
                  policies.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-zinc-300 ring-1 ring-white/10">
            <div className="flex items-start gap-2">
              <Wifi className="mt-0.5 h-4 w-4 text-zinc-200" />
              <div>
                <div className="font-semibold text-zinc-100">
                  For mobile data testing
                </div>
                <div className="mt-1 text-zinc-400">
                  Turn <span className="text-zinc-200">Wi-Fi OFF</span> before
                  scanning. Captive Wi-Fi often mimics “no data” symptoms.
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
              <div className="text-xs font-semibold tracking-wide text-zinc-400">
                SYSTEM HEALTH
              </div>
              <div className="mt-1 text-2xl font-black tracking-tight">
                {health.title}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-zinc-300">
                {health.detail}
              </div>
            </div>
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
              <HealthIcon className="h-6 w-6" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="text-[11px] text-zinc-500">Best Latency</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg font-extrabold">
                  {latestResult?.latency?.bestMs ?? "—"}
                </span>
                <span className="text-xs text-zinc-500">ms</span>
              </div>
            </div>
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="text-[11px] text-zinc-500">DNS</div>
              <div className="mt-1 text-lg font-extrabold">
                {latestResult?.dns?.ok == null
                  ? "—"
                  : latestResult.dns.ok
                    ? "OK"
                    : "BAD"}
              </div>
            </div>
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="text-[11px] text-zinc-500">Captive</div>
              <div className="mt-1 text-lg font-extrabold">
                {latestResult?.captive?.suspected == null
                  ? "—"
                  : latestResult.captive.suspected
                    ? "YES"
                    : "NO"}
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

  {/* Run Scan Button */}
  <button
    onClick={runScanFlow}
    className="w-full rounded-2xl bg-white text-zinc-950 shadow-lg shadow-white/10 ring-1 ring-white/20 active:scale-[0.99]"
  >
    <div className="flex items-center justify-center gap-3 px-4 py-4">
      {stage === "scanning" ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Wrench className="h-5 w-5" />
      )}
      <div className="text-base font-extrabold tracking-tight">
        {stage === "scanning" ? "Running Scan…" : "Run Scan"}
      </div>
    </div>
  </button>

  {/* Limited Mode Warning */}
  {!externalChecksEnabled && (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 ring-1 ring-amber-500/20">
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 h-4 w-4" />
        <div>
          External Diagnostics is <span className="font-semibold">OFF</span>.
          Results are limited.
          <br />
          Enable it above for full latency, DNS and captive portal testing.
        </div>
      </div>
    </div>
  )}

</div>

          {showAfterButton ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 ring-1 ring-white/10">
              <div className="mb-2 text-sm font-semibold text-zinc-100">
                A/B Step 2 — After Airplane Mode
              </div>
              <div className="text-xs text-zinc-400">
                Toggle airplane mode for{" "}
                <span className="text-zinc-200">10 seconds</span>, then tap
                “Re-Scan After Reset”.
              </div>
              <button
                onClick={runAfterFixFlow}
                className="mt-3 w-full rounded-2xl bg-zinc-100 text-zinc-950 ring-1 ring-white/20 active:scale-[0.99]"
              >
                <div className="flex items-center justify-center gap-3 px-4 py-3">
                  <Layers className="h-5 w-5" />
                  <div className="text-sm font-extrabold tracking-tight">
                    Re-Scan After Reset
                  </div>
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
            help="Shows whether airplane mode ‘reset’ improved things. Big improvement often means a stalled data session."
            right={
              baseline && after ? (
                <span className="text-xs text-zinc-400">delta view</span>
              ) : null
            }
          >
            <div className="space-y-3">
              {!baseline ? (
                <div className="text-sm text-zinc-400">
                  Run a scan to generate a baseline.
                </div>
              ) : (
                <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[11px] text-zinc-500">Baseline</div>
                      <div className="mt-1 text-sm font-bold text-zinc-100">
                        {baseline.latency.bestMs != null
                          ? `${baseline.latency.bestMs} ms`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">After Reset</div>
                      <div className="mt-1 text-sm font-bold text-zinc-100">
                        {after?.latency?.bestMs != null
                          ? `${after.latency.bestMs} ms`
                          : "—"}
                      </div>
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
                      <div className="mt-1">
                        {deltas.dnsChanged == null
                          ? "—"
                          : deltas.dnsChanged
                            ? "Yes"
                            : "No"}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white/5 p-2 ring-1 ring-white/10">
                      <div className="font-semibold text-zinc-200">Captive changed</div>
                      <div className="mt-1">
                        {deltas.captiveChanged == null
                          ? "—"
                          : deltas.captiveChanged
                            ? "Yes"
                            : "No"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-zinc-400">
                    Tip: Big improvement after reset → likely a{" "}
                    <span className="text-zinc-200">stalled session</span>. No
                    improvement → likely{" "}
                    <span className="text-zinc-200">congestion/coverage</span>.
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card
            title="Latency (Ping)"
            icon={Timer}
            help="Measures how long it takes to reach the internet. High latency can feel like slow/no data even with signal bars."
            right={
              latestResult?.latency?.bestMs != null ? (
                <span className="text-xs text-zinc-400">best of 2 probes</span>
              ) : null
            }
          >
            <div className="space-y-3">
              <MetricRow
                icon={Globe}
                label="google.com (204 probe)"
                value={
                  latestResult?.latency?.google204
                    ? `${latestResult.latency.google204.ms} ms`
                    : "—"
                }
                sub={
                  latestResult?.latency?.google204
                    ? latestResult.latency.google204.ok
                      ? latestResult.latency.google204.opaque
                        ? "Probe completed (opaque response)"
                        : "Probe completed"
                      : `Failed (${latestResult.latency.google204.error})`
                    : externalChecksEnabled
                      ? "Not tested"
                      : "Disabled (Privacy Mode)"
                }
                status={
                  !latestResult?.latency?.google204
                    ? externalChecksEnabled
                      ? "neutral"
                      : "warn"
                    : latestResult.latency.google204.ok
                      ? latestResult.latency.google204.ms >= 900
                        ? "bad"
                        : latestResult.latency.google204.ms >= 450
                          ? "warn"
                          : "good"
                      : "bad"
                }
              />
              <MetricRow
                icon={Network}
                label="Cloudflare (secondary probe)"
                value={
                  latestResult?.latency?.cloudflare
                    ? `${latestResult.latency.cloudflare.ms} ms`
                    : "—"
                }
                sub={
                  latestResult?.latency?.cloudflare
                    ? latestResult.latency.cloudflare.ok
                      ? latestResult.latency.cloudflare.opaque
                        ? "Probe completed (opaque response)"
                        : "Probe completed"
                      : `Failed (${latestResult.latency.cloudflare.error})`
                    : externalChecksEnabled
                      ? "Not tested"
                      : "Disabled (Privacy Mode)"
                }
                status={
                  !latestResult?.latency?.cloudflare
                    ? externalChecksEnabled
                      ? "neutral"
                      : "warn"
                    : latestResult.latency.cloudflare.ok
                      ? latestResult.latency.cloudflare.ms >= 900
                        ? "bad"
                        : latestResult.latency.cloudflare.ms >= 450
                          ? "warn"
                          : "good"
                      : "bad"
                }
              />
              <div className="rounded-2xl bg-white/5 p-3 text-xs text-zinc-400 ring-1 ring-white/10">
                <div className="flex items-start gap-2">
                  <CircleHelp className="mt-0.5 h-4 w-4 text-zinc-300" />
                  <div>
                    {latestResult?.latency?.note ||
                      "Latency is approximated via fetch timing (no true ICMP ping in browsers)."}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="Captive Portal Check"
            icon={ShieldAlert}
            help="Detects Wi-Fi networks that block the internet until you sign in (common on public Wi-Fi)."
          >
            <div className="space-y-3">
              <MetricRow
                icon={WifiOff}
                label="Login-required intercept"
                value={
                  latestResult?.captive?.suspected == null
                    ? "—"
                    : latestResult.captive.suspected
                      ? "Suspected"
                      : "Not detected"
                }
                sub={
                  latestResult?.captive?.note ||
                  (externalChecksEnabled ? "Not tested" : "Disabled (Privacy Mode)")
                }
                status={
                  latestResult?.captive?.suspected == null
                    ? externalChecksEnabled
                      ? "neutral"
                      : "warn"
                    : latestResult.captive.suspected
                      ? "warn"
                      : "good"
                }
              />
              <div className="rounded-2xl bg-white/5 p-3 text-xs text-zinc-400 ring-1 ring-white/10">
                Tip: If suspected, turn off Wi-Fi and retry the scan.
              </div>
            </div>
          </Card>

          <Card
            title="DNS Health"
            icon={Globe}
            help="DNS turns website names (like google.com) into IP addresses. If DNS breaks, apps may say ‘no internet’ even with signal."
          >
            <div className="space-y-3">
              <MetricRow
                icon={Globe}
                label="Domain resolution"
                value={
                  latestResult?.dns?.ok == null
                    ? "—"
                    : latestResult.dns.ok
                      ? "OK"
                      : "Broken"
                }
                sub={
                  latestResult?.dns?.note ||
                  (externalChecksEnabled ? "Not tested" : "Disabled (Privacy Mode)")
                }
                status={
                  latestResult?.dns?.ok == null
                    ? externalChecksEnabled
                      ? "neutral"
                      : "warn"
                    : latestResult.dns.ok
                      ? "good"
                      : "bad"
                }
              />
              <div className="rounded-2xl bg-white/5 p-3 text-xs text-zinc-400 ring-1 ring-white/10">
                If DNS is broken, check APN and disable VPN/Private DNS.
              </div>
            </div>
          </Card>

          <Card
            title="Device Factors"
            icon={Gauge}
            help="Best-effort signals from your browser (not hardware identifiers). Helps spot data saver, throttling, or a busy phone."
            right={netHint.supported ? <span className="text-xs text-zinc-400">best-effort</span> : null}
          >
            <div className="space-y-3">
              <MetricRow
                icon={Signal}
                label="Network hint"
                value={netHint.supported ? netHint.effectiveType.toUpperCase() : "Unknown"}
                sub={
                  netHint.supported
                    ? `Downlink: ${netHint.downlink ?? "—"} Mb/s · RTT: ${netHint.rtt ?? "—"} ms · Save-Data: ${
                        netHint.saveData == null ? "—" : netHint.saveData ? "ON" : "OFF"
                      }`
                    : "Your browser does not expose network hints."
                }
                status={netHint.supported ? "neutral" : "warn"}
              />

              <MetricRow
                icon={Activity}
                label="Device busy"
                value={longTaskMs ? `${longTaskMs} ms` : "0 ms"}
                sub="Time spent on long tasks while scanning (high values may mean CPU/thermal load)."
                status={longTaskMs >= 1500 ? "warn" : "good"}
              />

              <div className="rounded-2xl bg-white/5 p-3 text-xs text-zinc-400 ring-1 ring-white/10">
                <div className="font-semibold text-zinc-200">Quick meaning</div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Save-Data ON → disable for accurate tests.</li>
                  <li>High Device Busy → close heavy apps, retry, or reboot.</li>
                  <li>Healthy scan but apps fail → check VPN/Private DNS/data saver.</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card
            title="Carrier Configuration Guide"
            icon={Signal}
            help="APN is the carrier setting that lets your SIM connect to mobile data. Wrong APN can cause ‘no data’ even with signal."
            right={
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                className="rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-200 outline-none ring-1 ring-white/5"
              >
                <option value="unknown">Select carrier</option>
                <option value="simba">SIMBA</option>
                <option value="m1">M1</option>
                <option value="singtel">Singtel</option>
                <option value="starhub">StarHub</option>
              </select>
            }
          >
            <div className="space-y-3">
              <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <div className="text-xs font-semibold text-zinc-300">
                  Detected / Selected
                </div>
                <div className="mt-1 text-lg font-extrabold">
                  {carrierInfo.name}
                </div>
                <div className="mt-2 text-sm text-zinc-300">
                  <span className="text-zinc-400">APN:</span>{" "}
                  <span className="font-bold text-zinc-100">
                    {carrierInfo.apn}
                  </span>
                </div>
                <div className="mt-2 text-xs text-zinc-400">
                  {carrierInfo.notes}
                </div>
              </div>

              <div className="rounded-2xl bg-white/5 p-3 text-xs text-zinc-400 ring-1 ring-white/10">
                <div className="mb-2 text-xs font-semibold text-zinc-300">
                  Where to change APN
                </div>
                <div className="space-y-1">
                  <div>
                    <span className="font-semibold text-zinc-200">iPhone:</span>{" "}
                    Settings → Mobile Service → Mobile Data Network
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-200">Android:</span>{" "}
                    Settings → Network & Internet → SIMs → Access Point Names
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 ring-1 ring-white/10">
  <div className="flex items-start justify-between gap-4">
    <div>
      <div className="text-xs font-semibold tracking-wide text-zinc-400">DIAGNOSIS</div>

      <div className="mt-1 text-xl font-black tracking-tight">{diagnosis.label}</div>

      <div className="mt-2 text-sm leading-relaxed text-zinc-300">{diagnosis.reason}</div>

      {diagnosis.bullets?.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-300">
          {diagnosis.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}

      {externalChecksEnabled &&
        latestResult?.latency?.bestMs != null &&
        latestResult.latency.bestMs >= 900 && (
          <div className="mt-3 rounded-xl bg-white/5 p-3 text-xs text-zinc-300 ring-1 ring-white/10">
            <div className="font-semibold text-zinc-200">Auto Suggestion</div>
            <div className="mt-1 text-zinc-400">
              Latency is extremely high. Try switching to{" "}
              <span className="text-zinc-200">4G-only</span> temporarily (5G handover can cause stalled sessions),
              then toggle airplane mode and re-scan.
            </div>
          </div>
        )}
    </div>

    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <Activity className="h-6 w-6" />
    </div>
  </div>
</div>

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
                <span>Toggle Airplane Mode (10 seconds), then retry.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-lg bg-white/5 text-xs font-bold text-zinc-200 ring-1 ring-white/10">
                  2
                </span>
                <span>
                  Check APN (SIMBA: set APN to <b>tpg</b>), then restart mobile data.
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

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-zinc-400 ring-1 ring-white/10">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 text-zinc-300" />
              <div>
                <div className="font-semibold text-zinc-200">Security Deploy Notes</div>
                <div className="mt-1 leading-relaxed">
                  Deploy with a strict Content Security Policy (CSP) and allowlist
                  only required endpoints via{" "}
                  <span className="text-zinc-200">connect-src</span>. If External
                  Diagnostics is OFF, set{" "}
                  <span className="text-zinc-200">connect-src 'self'</span>.
                </div>
              </div>
            </div>
          </div>

          <div className="pb-2 pt-1 text-center text-xs text-zinc-500">
            Pro-tip: Run scan with Wi-Fi OFF to test true mobile data.
          </div>
        </div>
      </div>
    </div>
  );
}