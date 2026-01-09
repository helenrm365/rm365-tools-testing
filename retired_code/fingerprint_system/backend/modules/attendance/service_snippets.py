# SecuGen fingerprint matching service endpoints
# Can be overridden via SGI_ENDPOINTS environment variable (comma-separated list)
# Default: local SecuGen service on various common ports
_DEFAULT_SGI_ENDPOINTS = [
    "http://127.0.0.1:8080/SGIMatchScore",
]

def _get_sgi_endpoints() -> List[str]:
    """Get SGI endpoints from environment or use defaults"""
    env_endpoints = os.getenv('SGI_ENDPOINTS', '').strip()
    if env_endpoints:
        return [e.strip() for e in env_endpoints.split(',') if e.strip()]
    return _DEFAULT_SGI_ENDPOINTS

_SGI_ENDPOINTS = _get_sgi_endpoints()

@dataclass
class Match:
    employee_id: int
    name: str
    score: int

class AttendanceServiceSnippet:
    # ---- Fingerprint matching ----
    def identify_best_match(self, live_template_b64: str, threshold: int = 130, template_format: str = "ANSI") -> Optional[Match]:
        """
        Ask the local SGIMatchScore service to compare the live probe with each stored template.
        Returns the best match if score >= threshold.
        """
        candidates = self.repo.active_employee_templates()
        best = Match(employee_id=-1, name="", score=-1)

        for cand in candidates:
            cand_b64 = base64.b64encode(cand["tpl_bytes"]).decode("ascii")
            score = self._sgi_match_score(live_template_b64, cand_b64, template_format)
            if score is None:
                continue
            if score > best.score:
                best = Match(employee_id=cand["id"], name=cand["name"], score=score)

        if best.score >= threshold and best.employee_id != -1:
            return best
        return None

    def clock_by_fingerprint(self, live_template_b64: str) -> Dict[str, Any]:
        match = self.identify_best_match(live_template_b64)
        if not match:
            return {"status": "error", "message": "No matching fingerprint found"}

        direction = self.toggle_clock(match.employee_id)
        return {
            "status": "success",
            "message": f"Clocked {direction.upper()} for {match.name}",
            "employee": {"id": match.employee_id, "name": match.name, "score": match.score},
            "direction": direction.upper(),
        }

    @staticmethod
    def _sgi_match_score(live_b64: str, cand_b64: str, template_format: str = "ANSI") -> Optional[int]:
        payload = {
            "Template1": live_b64,
            "Template2": cand_b64,
            "TemplateFormat": template_format,
        }
        for ep in _SGI_ENDPOINTS:
            try:
                with httpx.Client(verify=False, timeout=5.0) as client:
                    r = client.post(ep, json=payload)
                    if r.status_code != 200:
                        continue
                    data = r.json()
                    if data.get("ErrorCode") != 0:
                        continue
                    score = data.get("Score")
                    if isinstance(score, int):
                        return score
            except Exception as e:
                print(f"Error matching against {ep}: {e}")
                continue
        return None

    def get_employee_templates(self) -> List[Dict[str, Any]]:
        """Get all employee fingerprint templates for client-side matching."""
        templates = self.repo.active_employee_templates()
        # Convert bytes to base64 string for JSON response
        return [
            {
                "id": t["id"],
                "name": t["name"],
                "template_b64": base64.b64encode(t["tpl_bytes"]).decode("ascii")
            }
            for t in templates
        ]
