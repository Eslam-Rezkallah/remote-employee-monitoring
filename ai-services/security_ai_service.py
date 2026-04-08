import json
import math
import re
import statistics
import sys
from collections import Counter
from datetime import datetime
from urllib.parse import urlparse

MODEL_NAME = "python-security-v1"


def load_models():
    return {
        "version": MODEL_NAME,
        "message_categories": {
            "phishing": ["verify", "password", "urgent", "bank", "invoice", "wire", "otp"],
            "malware": ["download", "exe", "macro", "payload", "script", "attachment"],
            "harassment": ["idiot", "hate", "stupid", "kill", "threat"],
            "secret_leak": ["apikey", "token", "secret", "password", "bearer"],
        },
    }


def read_payload():
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def tokenize(text):
    return re.findall(r"[a-zA-Z0-9_@:/\.-]+", str(text or "").lower())


def shannon_entropy(value):
    text = str(value or "")
    if not text:
        return 0.0
    counts = Counter(text)
    length = len(text)
    entropy = 0.0
    for count in counts.values():
        prob = count / length
        entropy -= prob * math.log2(prob)
    return round(entropy, 3)


def detect_message_categories(text):
    tokens = tokenize(text)
    token_text = " ".join(tokens)
    categories = []
    models = load_models()["message_categories"]
    for name, words in models.items():
        if any(word in token_text for word in words):
            categories.append(name)
    return categories


def levenshtein(left, right):
    a = str(left or "")
    b = str(right or "")
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i]
        for j, cb in enumerate(b, start=1):
            insert_cost = curr[j - 1] + 1
            delete_cost = prev[j] + 1
            replace_cost = prev[j - 1] + (0 if ca == cb else 1)
            curr.append(min(insert_cost, delete_cost, replace_cost))
        prev = curr
    return prev[-1]


def analyze_url(url):
    parsed = urlparse(str(url or "").strip())
    host = (parsed.netloc or "").lower()
    path = parsed.path or ""
    reasons = []
    score = 0

    if not host:
        return {
            "url": url,
            "host": host,
            "score": 80,
            "verdict": "suspicious",
            "reasons": ["missing-host"],
        }

    if parsed.scheme not in ("https", "http"):
        score += 20
        reasons.append("unexpected-scheme")
    if parsed.scheme == "http":
        score += 20
        reasons.append("no-tls")
    if host.count("-") >= 3:
        score += 15
        reasons.append("excessive-subdomain-hyphens")
    if re.search(r"\d+\.\d+\.\d+\.\d+", host):
        score += 25
        reasons.append("raw-ip-host")
    if "@" in str(url or ""):
        score += 25
        reasons.append("credential-obfuscation")
    if len(host) > 35:
        score += 10
        reasons.append("long-host")
    if any(word in host + path.lower() for word in ["login", "verify", "secure", "account", "wallet"]):
        score += 10
        reasons.append("credential-themed")
    if any(word in path.lower() for word in [".exe", ".zip", ".js", ".scr", ".bat"]):
        score += 25
        reasons.append("risky-download")

    verdict = "safe"
    if score >= 60:
        verdict = "suspicious"
    elif score >= 30:
        verdict = "review"

    return {
        "url": url,
        "host": host,
        "score": min(score, 100),
        "verdict": verdict,
        "reasons": reasons,
    }


def analyze_urls(urls):
    items = [analyze_url(url) for url in (urls or [])]
    top_score = max([item["score"] for item in items], default=0)
    return {
        "items": items,
        "score": top_score,
        "flaggedCount": len([item for item in items if item["verdict"] != "safe"]),
    }


def detect_secrets(text):
    content = str(text or "")
    findings = []

    patterns = [
        ("aws-access-key", r"AKIA[0-9A-Z]{16}"),
        ("github-token", r"gh[pousr]_[A-Za-z0-9]{20,}"),
        ("slack-token", r"xox[baprs]-[A-Za-z0-9-]{10,}"),
        ("jwt", r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+"),
        ("private-key", r"-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----"),
    ]

    for kind, pattern in patterns:
        for match in re.finditer(pattern, content):
            findings.append({"type": kind, "match": match.group(0)[:24] + "..."})

    for token in tokenize(content):
        if len(token) >= 24 and shannon_entropy(token) >= 4.0:
            findings.append({"type": "high-entropy-token", "match": token[:12] + "..."})
            break

    return findings


def scan_file(file_info):
    name = str((file_info or {}).get("originalName") or "")
    mime_type = str((file_info or {}).get("mimeType") or "").lower()
    size = int((file_info or {}).get("size") or 0)
    text_sample = str((file_info or {}).get("textSample") or "")

    score = 0
    reasons = []
    risky_ext = [".exe", ".dll", ".bat", ".cmd", ".scr", ".ps1", ".js", ".jar", ".vbs"]

    if any(name.lower().endswith(ext) for ext in risky_ext):
        score += 55
        reasons.append("risky-extension")
    if mime_type in {"application/x-msdownload", "application/x-sh", "application/x-dosexec"}:
        score += 40
        reasons.append("risky-mime-type")
    if size > 25 * 1024 * 1024:
        score += 15
        reasons.append("oversized-file")
    if detect_secrets(text_sample):
        score += 30
        reasons.append("embedded-secrets")

    verdict = "allow"
    if score >= 70:
        verdict = "block"
    elif score >= 35:
        verdict = "review"

    return {
        "name": name,
        "mimeType": mime_type,
        "size": size,
        "score": min(score, 100),
        "verdict": verdict,
        "reasons": reasons,
    }


def summarize_encryption_need(payload):
    sensitivity = str((payload or {}).get("dataSensitivity") or "internal").lower()
    transit = bool((payload or {}).get("inTransit", True))
    at_rest = bool((payload or {}).get("atRest", False))
    shared = bool((payload or {}).get("sharedOutsideOrg", False))

    score = 20
    if sensitivity in {"confidential", "secret", "restricted"}:
        score += 35
    if not transit:
        score += 20
    if not at_rest:
        score += 15
    if shared:
        score += 15

    recommendation = "recommended"
    if score >= 70:
        recommendation = "required"
    elif score < 35:
        recommendation = "optional"

    return {
        "score": min(score, 100),
        "recommendation": recommendation,
        "summary": "Use TLS in transit and managed key encryption at rest for sensitive or externally shared data.",
    }


def handle_message_guard(payload):
    content = str(payload.get("content") or "")
    urls = payload.get("urls") or re.findall(r"https?://\S+", content)
    categories = detect_message_categories(content)
    secrets = detect_secrets(content)
    url_result = analyze_urls(urls)
    entropy = shannon_entropy(content)

    score = len(categories) * 12 + len(secrets) * 25 + url_result["score"] * 0.5
    if entropy > 4.5 and len(content) > 30:
        score += 15

    score = min(int(round(score)), 100)
    verdict = "allow"
    if score >= 70:
        verdict = "block"
    elif score >= 35:
        verdict = "review"

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "score": score,
        "verdict": verdict,
        "categories": categories,
        "secrets": secrets,
        "urls": url_result["items"],
        "summary": "Potential abuse, phishing, or secret exposure signals were evaluated from content, URLs, and token patterns.",
    }


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def hour_bucket(value):
    dt = parse_iso(value)
    return None if dt is None else dt.hour


def handle_login_risk(payload):
    history = payload.get("history") or payload.get("loginHistory") or []
    ip = str(payload.get("ip") or "")
    country = str(payload.get("country") or "")
    user_agent = str(payload.get("userAgent") or "")
    timestamp = payload.get("timestamp")

    score = 5
    reasons = []
    prior_ips = {str(item.get("ip") or "") for item in history}
    prior_countries = {str(item.get("country") or "") for item in history}
    prior_agents = {str(item.get("userAgent") or "") for item in history}
    prior_hours = [hour_bucket(item.get("timestamp")) for item in history if hour_bucket(item.get("timestamp")) is not None]

    if ip and prior_ips and ip not in prior_ips:
        score += 25
        reasons.append("new-ip")
    if country and prior_countries and country not in prior_countries:
        score += 25
        reasons.append("new-country")
    if user_agent and prior_agents and user_agent not in prior_agents:
        score += 10
        reasons.append("new-device-fingerprint")

    login_hour = hour_bucket(timestamp)
    if login_hour is not None and prior_hours:
        average_hour = sum(prior_hours) / len(prior_hours)
        if abs(login_hour - average_hour) >= 8:
            score += 15
            reasons.append("unusual-login-time")

    if payload.get("vpnDetected"):
        score += 20
        reasons.append("vpn-or-proxy")
    if payload.get("failedAttempts", 0) >= 3:
        score += 20
        reasons.append("recent-failures")

    score = min(score, 100)
    verdict = "allow"
    if score >= 70:
        verdict = "challenge"
    elif score >= 40:
        verdict = "review"

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "score": score,
        "verdict": verdict,
        "reasons": reasons,
        "summary": "Login risk was scored from device novelty, location drift, timing deviation, and recent failed attempts.",
    }


def zscore_outliers(values):
    clean = [float(v) for v in (values or []) if isinstance(v, (int, float))]
    if len(clean) < 2:
        return []
    mean = statistics.mean(clean)
    stdev = statistics.pstdev(clean) or 1.0
    return [round((value - mean) / stdev, 3) for value in clean]


def handle_behavior_anomaly(payload):
    metrics = payload.get("metrics") or {}
    current = payload.get("current") or {}
    baseline_values = payload.get("baselineValues") or list(metrics.values())
    outliers = zscore_outliers(baseline_values)

    score = 0
    reasons = []
    for key, value in current.items():
        baseline = float(metrics.get(key) or 0)
        current_value = float(value or 0)
        if baseline <= 0:
            continue
        ratio = current_value / baseline
        if ratio >= 3:
            score += 25
            reasons.append(f"spike:{key}")
        elif ratio >= 1.8:
            score += 12
            reasons.append(f"elevated:{key}")

    if any(abs(z) >= 2.5 for z in outliers):
        score += 20
        reasons.append("statistical-outlier")
    if payload.get("afterHoursActivity"):
        score += 15
        reasons.append("after-hours-activity")

    score = min(score, 100)
    verdict = "normal"
    if score >= 65:
        verdict = "anomalous"
    elif score >= 35:
        verdict = "review"

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "score": score,
        "verdict": verdict,
        "reasons": reasons,
        "summary": "Behavior anomaly scoring compares current actions to the supplied baseline and highlights major deviations.",
    }


def handle_access_advisor(payload):
    role = str(payload.get("role") or "member").lower()
    action = str(payload.get("requestedAction") or "read").lower()
    sensitivity = str(payload.get("resourceSensitivity") or "internal").lower()
    mfa_enabled = bool(payload.get("mfaEnabled", False))
    trusted_ip = bool(payload.get("trustedIp", True))

    score = 0
    if action in {"delete", "export", "grant", "share"}:
        score += 20
    if sensitivity in {"confidential", "secret", "restricted"}:
        score += 25
    if role not in {"admin", "owner", "manager"} and action in {"delete", "grant", "export"}:
        score += 35
    if not mfa_enabled:
        score += 10
    if not trusted_ip:
        score += 10

    decision = "allow"
    if score >= 65:
        decision = "deny"
    elif score >= 35:
        decision = "step-up"

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "score": min(score, 100),
        "decision": decision,
        "summary": "Access advice combines requested action, role strength, sensitivity, MFA posture, and network trust.",
    }


def handle_incident_summary(payload):
    incidents = payload.get("incidents") or []
    severities = Counter(str(item.get("severity") or "unknown").lower() for item in incidents)
    categories = Counter(str(item.get("category") or "general").lower() for item in incidents)

    highest = "low"
    for level in ["critical", "high", "medium", "low"]:
        if severities.get(level):
            highest = level
            break

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "incidentCount": len(incidents),
        "highestSeverity": highest,
        "topCategories": categories.most_common(3),
        "summary": f"Processed {len(incidents)} incidents. Highest observed severity: {highest}.",
    }


def handle_log_siem(payload):
    logs = payload.get("logs") or []
    alerts = []
    failure_count = 0

    for entry in logs:
        message = str(entry.get("message") or entry.get("content") or "").lower()
        if "failed login" in message or "invalid password" in message:
            failure_count += 1
        if any(word in message for word in ["disabled antivirus", "privilege escalation", "token leak", "exfiltration"]):
            alerts.append({"severity": "high", "message": message[:160]})

    if failure_count >= 5:
        alerts.append({
            "severity": "medium",
            "message": "Multiple failed login events suggest brute-force activity.",
        })

    top_severity = "low"
    if any(alert["severity"] == "high" for alert in alerts):
        top_severity = "high"
    elif alerts:
        top_severity = "medium"

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "alertCount": len(alerts),
        "severity": top_severity,
        "alerts": alerts[:20],
        "summary": "Logs were scanned for repeated login failures and high-signal security phrases.",
    }


def handle_identity_verify(payload):
    checks = payload.get("checks") or {}
    document_score = float(checks.get("documentScore") or payload.get("documentScore") or 0)
    liveness_score = float(checks.get("livenessScore") or payload.get("livenessScore") or 0)
    email_verified = bool(checks.get("emailVerified", payload.get("emailVerified", False)))
    phone_verified = bool(checks.get("phoneVerified", payload.get("phoneVerified", False)))

    score = (document_score * 0.45) + (liveness_score * 0.35)
    if email_verified:
        score += 10
    if phone_verified:
        score += 10

    verdict = "fail"
    if score >= 80:
        verdict = "verified"
    elif score >= 60:
        verdict = "manual-review"

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "score": round(score, 2),
        "verdict": verdict,
        "summary": "Identity verification blends document confidence, liveness, and independent contact verification signals.",
    }


def handle_fraud_detect(payload):
    amount = float(payload.get("amount") or 0)
    transaction_count = int(payload.get("transactionCountLastHour") or 0)
    geo_mismatch = bool(payload.get("geoMismatch", False))
    device_mismatch = bool(payload.get("deviceMismatch", False))
    chargeback_history = int(payload.get("chargebackCount") or 0)

    score = 0
    if amount >= 5000:
        score += 25
    elif amount >= 1000:
        score += 10
    if transaction_count >= 10:
        score += 25
    elif transaction_count >= 5:
        score += 12
    if geo_mismatch:
        score += 20
    if device_mismatch:
        score += 15
    if chargeback_history >= 3:
        score += 20

    verdict = "allow"
    if score >= 70:
        verdict = "block"
    elif score >= 40:
        verdict = "review"

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "score": min(score, 100),
        "verdict": verdict,
        "summary": "Fraud signals include transaction amount, velocity, device mismatch, geo mismatch, and historical chargebacks.",
    }


def handle_user_risk(payload):
    mode = str(payload.get("mode") or "user_risk")
    behavior = float(payload.get("behaviorScore") or 0)
    fraud = float(payload.get("fraudScore") or 0)
    login = float(payload.get("loginRiskScore") or 0)
    admin = bool(payload.get("isPrivileged", False))
    insider_signals = int(payload.get("insiderSignals") or 0)

    score = (behavior * 0.35) + (fraud * 0.3) + (login * 0.25) + (insider_signals * 5)
    if admin:
        score += 10

    verdict = "low"
    if score >= 75:
        verdict = "critical"
    elif score >= 55:
        verdict = "high"
    elif score >= 30:
        verdict = "medium"

    label = "User risk" if mode != "insider_threat" else "Insider threat"
    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "score": round(min(score, 100), 2),
        "verdict": verdict,
        "summary": f"{label} combines login, behavior, fraud, and privilege context.",
    }


def handle_wifi_twin(payload):
    ssid = str(payload.get("ssid") or "")
    expected_bssid = str(payload.get("expectedBssid") or "").lower()
    observed = payload.get("observedNetworks") or []

    score = 0
    reasons = []
    similar_ssids = []

    for network in observed:
        candidate_ssid = str(network.get("ssid") or "")
        candidate_bssid = str(network.get("bssid") or "").lower()
        distance = levenshtein(ssid.lower(), candidate_ssid.lower())
        if candidate_ssid and candidate_ssid != ssid and distance <= 2:
            similar_ssids.append(candidate_ssid)
            score += 20
        if expected_bssid and candidate_ssid == ssid and candidate_bssid and candidate_bssid != expected_bssid:
            score += 35
            reasons.append("bssid-mismatch")
        if bool(network.get("openNetwork", False)):
            score += 10
            reasons.append("open-network")

    if similar_ssids:
        reasons.append("lookalike-ssid")

    verdict = "safe"
    if score >= 60:
        verdict = "likely-evil-twin"
    elif score >= 30:
        verdict = "review"

    return {
        "aiUsed": True,
        "aiModel": MODEL_NAME,
        "score": min(score, 100),
        "verdict": verdict,
        "similarSsids": similar_ssids[:10],
        "summary": "Wi-Fi twin detection looks for BSSID drift and near-match SSID impersonation.",
    }


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = read_payload()

    if command == "message_guard":
        result = handle_message_guard(payload)
    elif command == "url_guard":
        url_result = analyze_urls(payload.get("urls") or [])
        result = {
            "aiUsed": True,
            "aiModel": MODEL_NAME,
            **url_result,
            "summary": "URLs were scored for transport security, obfuscation, download risk, and phishing cues.",
        }
    elif command == "secret_scan":
        findings = detect_secrets(payload.get("text") or payload.get("content") or "")
        result = {
            "aiUsed": True,
            "aiModel": MODEL_NAME,
            "score": min(len(findings) * 30, 100),
            "findings": findings,
            "summary": "Secret scanning checks for token formats, private keys, JWTs, and high-entropy strings.",
        }
    elif command == "file_scan":
        files = payload.get("files") or []
        items = [scan_file(file_info) for file_info in files]
        result = {
            "aiUsed": True,
            "aiModel": MODEL_NAME,
            "items": items,
            "score": max([item["score"] for item in items], default=0),
            "summary": "File scanning evaluates extension, MIME type, size, and sampled content for secrets.",
        }
    elif command == "login_risk":
        result = handle_login_risk(payload)
    elif command == "behavior_anomaly":
        result = handle_behavior_anomaly(payload)
    elif command == "access_advisor":
        result = handle_access_advisor(payload)
    elif command == "incident_summary":
        result = handle_incident_summary(payload)
    elif command == "log_siem":
        result = handle_log_siem(payload)
    elif command == "identity_verify":
        result = handle_identity_verify(payload)
    elif command == "encryption_advisor":
        result = {"aiUsed": True, "aiModel": MODEL_NAME, **summarize_encryption_need(payload)}
    elif command == "fraud_detect":
        result = handle_fraud_detect(payload)
    elif command == "user_risk":
        result = handle_user_risk(payload)
    elif command == "wifi_twin":
        result = handle_wifi_twin(payload)
    else:
        result = {
            "aiUsed": False,
            "aiModel": MODEL_NAME,
            "aiFallbackReason": f"Unsupported command: {command}",
        }

    print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
