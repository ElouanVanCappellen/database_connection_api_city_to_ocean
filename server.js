// https://www.npmjs.com/package/jsonwebtoken
// https://auth0.com/learn/json-web-tokens
// https://datatracker.ietf.org/doc/html/rfc7519#page-4
// https://expressjs.com/en/guide/writing-middleware.html




import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import Connector from "./Connector.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const db = new Connector();

const PORT = Number(process.env.API_PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.warn("⚠️ Missing JWT_SECRET in .env (required for auth endpoints)");
}

// -------------------- helpers --------------------
function signToken(user) {
    return jwt.sign(
        {
            sub: String(user.id),
            email: user.email,
            displayName: user.display_name,
            isGuest: !!user.is_guest,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
}

function authRequired(req, res, next) {
    try {
        const header = req.headers.authorization || "";
        const [type, token] = header.split(" ");
        if (type !== "Bearer" || !token) {
            return res.status(401).json({ ok: false, error: "Missing token" });
        }
        const payload = jwt.verify(token, JWT_SECRET);

        req.user = {
            id: Number(payload.sub),
            email: payload.email,
            displayName: payload.displayName,
            isGuest: !!payload.isGuest,
        };

        next();
    } catch {
        return res.status(401).json({ ok: false, error: "Invalid token" });
    }
}


// https://www.regular-expressions.info/email.html
// https://stackoverflow.com/questions/46155/how-can-i-validate-an-email-address-in-javascript
function isEmail(s) {
    return (
        typeof s === "string" &&
        /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(
            s
        )
    );
}

// ---------------------------------------------- health ----------------------------------------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/test-db", async (req, res) => {
    try {
        const rows = await db.query("SELECT 1 + 1 AS result");
        res.json({ ok: true, rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});


// -------------------------------------------- authentication --------------------------------------------

app.post("/api/auth/register", async (req, res) => {
    try {
        const { email, password, displayName } = req.body || {};


        if (!isEmail(email)) return res.status(400).json({ ok: false, error: "Invalid email" });

        if (typeof password !== "string" || password.length < 6)
            return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });

        if (typeof displayName !== "string" || displayName.trim().length < 2)
            return res.status(400).json({ ok: false, error: "Display name too short" });


        const existing = await db.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);

        if (existing.length) return res.status(409).json({ ok: false, error: "Email already in use" });


        const passwordHash = await bcrypt.hash(password, 10);

        const result = await db.query(
            "INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)",
            [email, passwordHash, displayName.trim()]
        );

        const user = { id: result.insertId, email, display_name: displayName.trim() };
        const token = signToken(user);


        res.status(201).json({ ok: true, token, user: { id: user.id, email, displayName: user.display_name } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// --------------------------------------------authentication--------------------------------------------
// Register (non-guest)
app.post("/api/auth/register", async (req, res) => {
    try {
        const { email, password, displayName } = req.body || {};

        if (!isEmail(email)) return res.status(400).json({ ok: false, error: "Invalid email" });
        if (typeof password !== "string" || password.length < 6)
            return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });
        if (typeof displayName !== "string" || displayName.trim().length < 2)
            return res.status(400).json({ ok: false, error: "Display name too short" });

        const existing = await db.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
        if (existing.length) return res.status(409).json({ ok: false, error: "Email already in use" });

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await db.query(
            "INSERT INTO users (email, password_hash, display_name, is_guest) VALUES (?, ?, ?, 0)",
            [email, passwordHash, displayName.trim()]
        );

        const user = { id: result.insertId, email, display_name: displayName.trim(), is_guest: 0 };
        const token = signToken(user);

        res.status(201).json({
            ok: true,
            token,
            user: { id: user.id, email: user.email, displayName: user.display_name, isGuest: false },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Login (could be guest or non-guest; you probably only use it for real users)
app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!isEmail(email) || typeof password !== "string")
            return res.status(400).json({ ok: false, error: "Invalid credentials" });

        const rows = await db.query(
            "SELECT id, email, password_hash, display_name, is_guest FROM users WHERE email = ? LIMIT 1",
            [email]
        );
        if (!rows.length) return res.status(401).json({ ok: false, error: "Invalid credentials" });

        const user = rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

        const token = signToken(user);

        res.json({
            ok: true,
            token,
            user: { id: user.id, email: user.email, displayName: user.display_name, isGuest: !!user.is_guest },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Guest login (frontend calls this automatically when no token exists)
app.post("/api/auth/guest", async (req, res) => {
    try {
        const guestEmail = `guest-${crypto.randomUUID()}@guest.local`;
        const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);

        const result = await db.query(
            "INSERT INTO users (email, password_hash, display_name, is_guest) VALUES (?, ?, 'Guest', 1)",
            [guestEmail, passwordHash]
        );

        const user = { id: result.insertId, email: guestEmail, display_name: "Guest", is_guest: 1 };
        const token = signToken(user);

        res.status(201).json({
            ok: true,
            token,
            user: { id: user.id, email: user.email, displayName: user.display_name, isGuest: true },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Current user (guests allowed)
app.get("/api/me", authRequired, async (req, res) => {
    try {
        const rows = await db.query(
            "SELECT id, email, display_name, is_guest, created_at FROM users WHERE id = ? LIMIT 1",
            [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: "User not found" });
        const u = rows[0];
        res.json({ ok: true, user: { id: u.id, email: u.email, displayName: u.display_name, isGuest: !!u.is_guest } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Stats (guests: no stats)

app.get("/api/me/stats", authRequired, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.json({ ok: true, stats: null, note: "Guest accounts do not have persistent stats." });
        }

        const scansCount = await db.query("SELECT COUNT(*) AS scans FROM scans WHERE user_id = ?", [req.user.id]);
        const detectionsCount = await db.query(
            `SELECT COUNT(*) AS detections
            FROM detections d
            JOIN scans s ON s.id = d.scan_id
            WHERE s.user_id = ?`,
            [req.user.id]
        );

        res.json({
            ok: true,
            stats: {
                scans: scansCount[0]?.scans ?? 0,
                detections: detectionsCount[0]?.detections ?? 0,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// --------------------------------------------events--------------------------------------------


app.get("/api/events", authRequired, async (req, res) => {
    try {
        const rows = await db.query("SELECT * FROM events ORDER BY starts_at DESC, created_at DESC");
        res.json({ ok: true, events: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post("/api/events", authRequired, async (req, res) => {
    try {
        const { title, description = null, startsAt = null, endsAt = null, locationName = null } = req.body || {};
        if (typeof title !== "string" || title.trim().length < 2)
            return res.status(400).json({ ok: false, error: "Title too short" });

        const result = await db.query(
            "INSERT INTO events (title, description, starts_at, ends_at, location_name) VALUES (?, ?, ?, ?, ?)",
            [title.trim(), description, startsAt, endsAt, locationName]
        );

        const created = await db.query("SELECT * FROM events WHERE id = ? LIMIT 1", [result.insertId]);
        res.status(201).json({ ok: true, event: created[0] });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});


// --------------------------------------------cleanups--------------------------------------------

app.get("/api/cleanups", authRequired, async (req, res) => {
    try {
        const { eventId } = req.query;

        let sql =
            "SELECT c.*, e.title AS event_title, u.display_name AS created_by_name " +
            "FROM cleanups c " +
            "LEFT JOIN events e ON e.id = c.event_id " +
            "LEFT JOIN users u ON u.id = c.created_by ";
        const params = [];

        if (eventId) {
            sql += "WHERE c.event_id = ? ";
            params.push(Number(eventId));
        }

        sql += "ORDER BY c.starts_at DESC, c.created_at DESC";

        const rows = await db.query(sql, params);
        res.json({ ok: true, cleanups: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post("/api/cleanups", authRequired, async (req, res) => {
    try {
        const { eventId = null, name, cleanupType, startsAt = null, endsAt = null } = req.body || {};

        if (typeof name !== "string" || name.trim().length < 2)
            return res.status(400).json({ ok: false, error: "Name too short" });

        if (!["KAAI", "KANAAL"].includes(cleanupType))
            return res.status(400).json({ ok: false, error: "Invalid cleanupType" });

        const result = await db.query(
            "INSERT INTO cleanups (event_id, name, cleanup_type, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?)",
            [eventId ? Number(eventId) : null, name.trim(), cleanupType, startsAt, endsAt, req.user.id]
        );

        const created = await db.query("SELECT * FROM cleanups WHERE id = ? LIMIT 1", [result.insertId]);
        res.status(201).json({ ok: true, cleanup: created[0] });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// =====================================================
// SCANS + DETECTIONS + CORRECTIONS
// Guests are allowed to upload/edit their own detections.
// =====================================================

// Create scan (+ optional detections array)
app.post("/api/scans", authRequired, async (req, res) => {
    try {
        const {
            cleanupId = null,
            imageUrl,
            takenAt = null,
            lat = null,
            lng = null,
            gpsAccuracyM = null,
            notes = null,
            detections = [], // optional
        } = req.body || {};

        if (typeof imageUrl !== "string" || imageUrl.length < 5)
            return res.status(400).json({ ok: false, error: "imageUrl required" });

        const insertScan = await db.query(
            "INSERT INTO scans (user_id, cleanup_id, image_url, taken_at, lat, lng, gps_accuracy_m, notes) VALUES (?, ?, ?, COALESCE(?, NOW()), ?, ?, ?, ?)",
            [req.user.id, cleanupId ? Number(cleanupId) : null, imageUrl, takenAt, lat, lng, gpsAccuracyM, notes]
        );

        const scanId = insertScan.insertId;

        if (Array.isArray(detections) && detections.length) {
            for (const d of detections) {
                const {
                    wasteTypeAi,
                    brandAi = null,
                    confAi = null,
                    x1 = null,
                    y1 = null,
                    x2 = null,
                    y2 = null,
                    cropImageUrl = null,
                } = d || {};

                if (!wasteTypeAi) continue;

                await db.query(
                    "INSERT INTO detections (scan_id, waste_type_ai, brand_ai, conf_ai, x1, y1, x2, y2, crop_image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [scanId, wasteTypeAi, brandAi, confAi, x1, y1, x2, y2, cropImageUrl]
                );
            }
        }

        // Guests do NOT earn achievements
        if (!req.user.isGuest) {
            await db.query(
                `INSERT INTO user_achievements (user_id, achievement_id)
         SELECT ?, a.id FROM achievements a WHERE a.code = 'FIRST_SCAN'
         ON DUPLICATE KEY UPDATE earned_at = earned_at`,
                [req.user.id]
            );
        }

        res.status(201).json({ ok: true, scanId });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/scans", authRequired, async (req, res) => {
    try {
        const { cleanupId, limit = 50, offset = 0 } = req.query;

        let sql =
            "SELECT s.*, c.name AS cleanup_name, e.title AS event_title " +
            "FROM scans s " +
            "LEFT JOIN cleanups c ON c.id = s.cleanup_id " +
            "LEFT JOIN events e ON e.id = c.event_id " +
            "WHERE s.user_id = ? ";
        const params = [req.user.id];

        if (cleanupId) {
            sql += "AND s.cleanup_id = ? ";
            params.push(Number(cleanupId));
        }

        sql += "ORDER BY s.taken_at DESC LIMIT ? OFFSET ?";
        params.push(Number(limit), Number(offset));

        const rows = await db.query(sql, params);
        res.json({ ok: true, scans: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/scans/:id", authRequired, async (req, res) => {
    try {
        const scanId = Number(req.params.id);

        const scanRows = await db.query("SELECT * FROM scans WHERE id = ? AND user_id = ? LIMIT 1", [
            scanId,
            req.user.id,
        ]);
        if (!scanRows.length) return res.status(404).json({ ok: false, error: "Scan not found" });

        const detRows = await db.query(
            `
      SELECT
        d.id AS detection_id,
        d.scan_id,
        COALESCE(c.waste_type_user, d.waste_type_ai) AS waste_type,
        COALESCE(c.brand_user, d.brand_ai)          AS brand,
        d.conf_ai,
        d.x1, d.y1, d.x2, d.y2,
        d.crop_image_url,
        c.created_at AS corrected_at
      FROM detections d
      LEFT JOIN detection_corrections c
        ON c.id = (
          SELECT c2.id
          FROM detection_corrections c2
          WHERE c2.detection_id = d.id
          ORDER BY c2.created_at DESC
          LIMIT 1
        )
      WHERE d.scan_id = ?
      ORDER BY d.id
      `,
            [scanId]
        );

        res.json({ ok: true, scan: scanRows[0], detections: detRows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Add a correction to a detection (allowed for guests, but only on their own detections)
app.post("/api/detections/:id/corrections", authRequired, async (req, res) => {
    try {
        const detectionId = Number(req.params.id);
        const { wasteTypeUser = null, brandUser = null, comment = null } = req.body || {};

        const check = await db.query(
            `SELECT d.id
       FROM detections d
       JOIN scans s ON s.id = d.scan_id
       WHERE d.id = ? AND s.user_id = ?
       LIMIT 1`,
            [detectionId, req.user.id]
        );

        if (!check.length) return res.status(404).json({ ok: false, error: "Detection not found" });

        const result = await db.query(
            "INSERT INTO detection_corrections (detection_id, user_id, waste_type_user, brand_user, comment) VALUES (?, ?, ?, ?, ?)",
            [detectionId, req.user.id, wasteTypeUser, brandUser, comment]
        );

        res.status(201).json({ ok: true, correctionId: result.insertId });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// =====================================================
// ACHIEVEMENTS
// Guests: can view catalog, but “mine” is empty.
// =====================================================

app.get("/api/achievements/catalog", authRequired, async (req, res) => {
    try {
        const rows = await db.query("SELECT * FROM achievements ORDER BY id ASC");
        res.json({ ok: true, achievements: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/achievements/mine", authRequired, async (req, res) => {
    try {
        if (req.user.isGuest) return res.json({ ok: true, earned: [] });

        const rows = await db.query(
            `
        SELECT a.code, a.title, a.description, ua.earned_at
        FROM user_achievements ua
        JOIN achievements a ON a.id = ua.achievement_id
        WHERE ua.user_id = ?
        ORDER BY ua.earned_at DESC
        `,
            [req.user.id]
        );

        res.json({ ok: true, earned: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});