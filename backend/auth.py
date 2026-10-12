from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Optional, Dict, Any
from flask import request, jsonify
import jwt
from werkzeug.security import generate_password_hash, check_password_hash

from config import (
    ADMIN_USERNAME,
    ADMIN_PASSWORD,
    JWT_SECRET,
    JWT_ALGORITHM,
    JWT_EXPIRATION_HOURS,
    RFID_API_SECRET
)

# Store password hash in memory (initialized from config)
_stored_password_hash = generate_password_hash(ADMIN_PASSWORD)

def verify_admin_credentials(username: str, password: str) -> bool:
    """Verifies administrator username and password securely."""
    if not username or not password:
        return False
    if username.strip() != ADMIN_USERNAME:
        return False
    return check_password_hash(_stored_password_hash, password.strip())

def create_admin_token(username: str = ADMIN_USERNAME) -> str:
    """Creates a signed JWT admin session token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "role": "admin",
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_admin_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes and validates an admin JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def extract_bearer_token() -> Optional[str]:
    """Extracts token from Authorization header or Cookie."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header.split(" ", 1)[1].strip()
    # Also check cookie if used
    return request.cookies.get("techbots_admin_token")

def admin_required(f):
    """Decorator to protect admin-only endpoints."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = extract_bearer_token()
        if not token:
            return jsonify({
                "success": False,
                "error": "Authentication required. Please login as administrator."
            }), 401

        payload = decode_admin_token(token)
        if not payload or payload.get("role") != "admin":
            return jsonify({
                "success": False,
                "error": "Invalid or expired administrator session."
            }), 401

        return f(*args, **kwargs)
    return decorated_function

def hardware_or_admin_required(f):
    """
    Allows RFID hardware (ESP32) presenting X-API-Key or Bearer secret,
    or authenticated admin, or local simulator requests.
    Supports headers, query params, or JSON body keys for ESP32 compatibility.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 1. Check Hardware API Key header (multiple casing/naming variants)
        hw_key = (
            request.headers.get("X-API-Key") or
            request.headers.get("X-Api-Key") or
            request.headers.get("X-RFID-Secret") or
            request.headers.get("X-Rfid-Secret") or
            request.headers.get("api-key") or
            request.headers.get("api_key")
        )

        # 2. Check query parameter or JSON body fallback for embedded firmware
        if not hw_key:
            hw_key = request.args.get("api_key") or request.args.get("key") or request.args.get("secret")

        if not hw_key:
            payload = request.get_json(silent=True)
            if isinstance(payload, dict):
                hw_key = payload.get("api_key") or payload.get("key") or payload.get("secret")

        if hw_key and hw_key == RFID_API_SECRET:
            return f(*args, **kwargs)

        # 3. Check Bearer token (matches either RFID_API_SECRET or valid admin token)
        token = extract_bearer_token()
        if token:
            if token == RFID_API_SECRET:
                return f(*args, **kwargs)
            payload = decode_admin_token(token)
            if payload:
                return f(*args, **kwargs)

        # 4. Allow requests originating from dashboard simulator (checked via custom header)
        client_source = request.headers.get("X-Client-Source")
        if client_source == "TechBots-Dashboard-Simulator":
            return f(*args, **kwargs)

        # If none matched, reject with 401
        return jsonify({
            "success": False,
            "error": "Unauthorized hardware or simulator request. Missing valid X-API-Key or session."
        }), 401
    return decorated_function

