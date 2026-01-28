// this code whas written with the help of sources and adapted by Elouan Van Cappellen
// this code was adapted by Elouan Van Cappellen:
// https://www.npmjs.com/package/jsonwebtoken
// https://auth0.com/learn/json-web-tokens
// https://datatracker.ietf.org/doc/html/rfc7519#page-4
// https://expressjs.com/en/guide/writing-middleware.html

// https://www.npmjs.com/package/jsonwebtoken
// https://auth0.com/learn/json-web-tokens
// https://datatracker.ietf.org/doc/html/rfc7519
// https://expressjs.com/en/guide/writing-middleware.html

import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import Connector from "./Connector.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

process.on("uncaughtException", (err) => console.error("🔥 uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("🔥 unhandledRejection:", err));

const db = new Connector();

const PORT = Number(process.env.PORT) || Number(process.env.API_PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET environment variable");

// -------------------- helpers --------------------
function oid(id) {
    try {
        return new ObjectId(id);
    } catch {
        return null;
    }
}

function signToken(user) {
    return jwt.sign(
        {
            sub: String(user._id),
            email: user.email,
            displayName: user.displayName,
            isGuest: !!user.isGuest
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
}

function authRequired(req, res, next) {
    try {
        const header = req.headers.authorization || "";
        const [type, token] = header.split(" ");
        if (type !== "Bearer" || !token) return res.status(401).json({ ok: false, error: "Missing token" });

        const payload = jwt.verify(token, JWT_SECRET);

        req.user = {
            id: String(payload.sub),
            email: payload.email,
            displayName: payload.displayName,
            isGuest: !!payload.isGuest
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

// -------------------- collections --------------------
async function usersCol() { return db.col("users"); }
async function eventsCol() { return db.col("events"); }
async function cleanupsCol() { return db.col("cleanups"); }
async function scansCol() { return db.col("scans"); }
async function achievementsCol() { return db.col("achievements"); }
async function userAchievementsCol() { return db.col("user_achievements"); }

// -------------------- health --------------------
app.get("/api", (req, res) => {
    res.json({
        ok: true,
        name: "Trash Collector API",
        endpoints: [
            "GET /api/health",
            "GET /api/test-db",
            "POST /api/auth/guest",
            "POST /api/auth/register",
            "POST /api/auth/login",
            "GET /api/me",
            "GET /api/me/stats",
            "GET /api/events",
            "POST /api/events",
            "GET /api/cleanups",
            "POST /api/cleanups",
            "POST /api/scans",
            "GET /api/scans",
            "GET /api/scans/:id",
            "POST /api/detections/:id/corrections",
            "GET /api/achievements/catalog",
            "GET /api/achievements/mine"
        ]
    });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/test-db", async (req, res) => {
    try {
        const u = await usersCol();
        await u.findOne({}, { projection: { _id: 1 } });
        res.json({ ok: true, result: "Mongo connected" });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// -------------------- authentication --------------------

// Register (non-guest)
app.post("/api/auth/register", async (req, res) => {
    try {
        const { email, password, displayName } = req.body || {};

        if (!isEmail(email)) return res.status(400).json({ ok: false, error: "Invalid email" });
        if (typeof password !== "string" || password.length < 6)
            return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });
        if (typeof displayName !== "string" || displayName.trim().length < 2)
            return res.status(400).json({ ok: false, error: "Display name too short" });

        const users = await usersCol();

        const existing = await users.findOne({ email: email.toLowerCase() }, { projection: { _id: 1 } });
        if (existing) return res.status(409).json({ ok: false, error: "Email already in use" });

        const passwordHash = await bcrypt.hash(password, 10);

        const doc = {
            email: email.toLowerCase(),
            passwordHash,
            displayName: displayName.trim(),
            isGuest: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await users.insertOne(doc);
        const user = { ...doc, _id: result.insertedId };

        const token = signToken(user);

        res.status(201).json({
            ok: true,
            token,
            user: { id: String(user._id), email: user.email, displayName: user.displayName, isGuest: false }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Login
app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!isEmail(email) || typeof password !== "string")
            return res.status(400).json({ ok: false, error: "Invalid credentials" });

        const users = await usersCol();
        const user = await users.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

        const token = signToken(user);

        res.json({
            ok: true,
            token,
            user: { id: String(user._id), email: user.email, displayName: user.displayName, isGuest: !!user.isGuest }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Guest login
app.post("/api/auth/guest", async (req, res) => {
    try {
        const users = await usersCol();

        const guestEmail = `guest-${crypto.randomUUID()}@guest.local`;
        const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);

        const doc = {
            email: guestEmail,
            passwordHash,
            displayName: "Guest",
            isGuest: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await users.insertOne(doc);
        const user = { ...doc, _id: result.insertedId };

        const token = signToken(user);

        res.status(201).json({
            ok: true,
            token,
            user: { id: String(user._id), email: user.email, displayName: user.displayName, isGuest: true }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Current user
app.get("/api/me", authRequired, async (req, res) => {
    try {
        const users = await usersCol();
        const _id = oid(req.user.id);
        if (!_id) return res.status(400).json({ ok: false, error: "Invalid user id" });

        const u = await users.findOne({ _id }, { projection: { passwordHash: 0 } });
        if (!u) return res.status(404).json({ ok: false, error: "User not found" });

        res.json({
            ok: true,
            user: { id: String(u._id), email: u.email, displayName: u.displayName, isGuest: !!u.isGuest }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Stats (no guests)
app.get("/api/me/stats", authRequired, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.json({ ok: true, stats: null, note: "Guest accounts do not have persistent stats." });
        }

        const scans = await scansCol();
        const userId = req.user.id;

        const scansCount = await scans.countDocuments({ userId });
        const detectionsCountAgg = await scans.aggregate([
            { $match: { userId } },
            { $project: { detectionsCount: { $size: { $ifNull: ["$detections", []] } } } },
            { $group: { _id: null, total: { $sum: "$detectionsCount" } } }
        ]).toArray();

        res.json({
            ok: true,
            stats: {
                scans: scansCount,
                detections: detectionsCountAgg[0]?.total ?? 0
            }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// -------------------- events --------------------
app.get("/api/events", authRequired, async (req, res) => {
    try {
        const events = await eventsCol();
        const rows = await events.find({}).sort({ startsAt: -1, createdAt: -1 }).toArray();
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

        const events = await eventsCol();
        const doc = {
            title: title.trim(),
            description,
            startsAt: startsAt ? new Date(startsAt) : null,
            endsAt: endsAt ? new Date(endsAt) : null,
            locationName,
            createdAt: new Date()
        };

        const result = await events.insertOne(doc);
        res.status(201).json({ ok: true, event: { ...doc, _id: result.insertedId } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// -------------------- cleanups --------------------
app.get("/api/cleanups", authRequired, async (req, res) => {
    try {
        const { eventId } = req.query;
        const cleanups = await cleanupsCol();

        const filter = {};
        if (eventId) filter.eventId = String(eventId);

        const rows = await cleanups.find(filter).sort({ startsAt: -1, createdAt: -1 }).toArray();
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

        const cleanups = await cleanupsCol();
        const doc = {
            eventId: eventId ? String(eventId) : null,
            name: name.trim(),
            cleanupType,
            startsAt: startsAt ? new Date(startsAt) : null,
            endsAt: endsAt ? new Date(endsAt) : null,
            createdBy: req.user.id,
            createdAt: new Date()
        };

        const result = await cleanups.insertOne(doc);
        res.status(201).json({ ok: true, cleanup: { ...doc, _id: result.insertedId } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// -------------------- scans + detections + corrections --------------------
// In Mongo we store detections inside the scan document.
// Corrections are stored per detection as an array of edits.

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
            detections = []
        } = req.body || {};

        if (typeof imageUrl !== "string" || imageUrl.length < 5)
            return res.status(400).json({ ok: false, error: "imageUrl required" });

        const scans = await scansCol();

        const detDocs = Array.isArray(detections)
            ? detections
                .filter((d) => d?.wasteTypeAi)
                .map((d) => ({
                    _id: new ObjectId(), // local id for the detection inside the scan
                    wasteTypeAi: d.wasteTypeAi,
                    brandAi: d.brandAi ?? null,
                    confAi: d.confAi ?? null,
                    x1: d.x1 ?? null,
                    y1: d.y1 ?? null,
                    x2: d.x2 ?? null,
                    y2: d.y2 ?? null,
                    cropImageUrl: d.cropImageUrl ?? null,
                    createdAt: new Date(),
                    corrections: [] // newest correction last
                }))
            : [];

        const doc = {
            userId: req.user.id,
            cleanupId: cleanupId ? String(cleanupId) : null,
            imageUrl, // link to your cloud image storage
            takenAt: takenAt ? new Date(takenAt) : new Date(),
            location: {
                lat,
                lng,
                gpsAccuracyM
            },
            notes,
            detections: detDocs,
            createdAt: new Date()
        };

        const result = await scans.insertOne(doc);

        // Achievements: guests do NOT earn
        if (!req.user.isGuest) {
            const ach = await achievementsCol();
            const ua = await userAchievementsCol();

            const firstScan = await ach.findOne({ code: "FIRST_SCAN" }, { projection: { _id: 1 } });
            if (firstScan) {
                await ua.updateOne(
                    { userId: req.user.id, achievementId: String(firstScan._id) },
                    { $setOnInsert: { userId: req.user.id, achievementId: String(firstScan._id), earnedAt: new Date() } },
                    { upsert: true }
                );
            }
        }

        res.status(201).json({ ok: true, scanId: String(result.insertedId) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/scans", authRequired, async (req, res) => {
    try {
        const { cleanupId, limit = 50, offset = 0 } = req.query;

        const scans = await scansCol();
        const filter = { userId: req.user.id };
        if (cleanupId) filter.cleanupId = String(cleanupId);

        const rows = await scans
            .find(filter)
            .sort({ takenAt: -1 })
            .skip(Number(offset))
            .limit(Number(limit))
            .toArray();

        res.json({ ok: true, scans: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/scans/:id", authRequired, async (req, res) => {
    try {
        const scans = await scansCol();
        const _id = oid(req.params.id);
        if (!_id) return res.status(400).json({ ok: false, error: "Invalid scan id" });

        const scan = await scans.findOne({ _id, userId: req.user.id });
        if (!scan) return res.status(404).json({ ok: false, error: "Scan not found" });

        // For each detection, compute the “current truth” (latest correction or AI values)
        const detections = (scan.detections ?? []).map((d) => {
            const latest = (d.corrections ?? []).at(-1);
            return {
                detectionId: String(d._id),
                scanId: String(scan._id),
                wasteType: latest?.wasteTypeUser ?? d.wasteTypeAi,
                brand: latest?.brandUser ?? d.brandAi,
                confAi: d.confAi,
                x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2,
                cropImageUrl: d.cropImageUrl,
                correctedAt: latest?.createdAt ?? null
            };
        });

        res.json({ ok: true, scan, detections });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post("/api/detections/:id/corrections", authRequired, async (req, res) => {
    try {
        const detectionId = oid(req.params.id);
        if (!detectionId) return res.status(400).json({ ok: false, error: "Invalid detection id" });

        const { wasteTypeUser = null, brandUser = null, comment = null } = req.body || {};

        const scans = await scansCol();

        // Ensure detection exists and belongs to this user (because scan belongs to user)
        const scan = await scans.findOne(
            { userId: req.user.id, "detections._id": detectionId },
            { projection: { _id: 1 } }
        );
        if (!scan) return res.status(404).json({ ok: false, error: "Detection not found" });

        const correction = {
            _id: new ObjectId(),
            userId: req.user.id,
            wasteTypeUser,
            brandUser,
            comment,
            createdAt: new Date()
        };

        await scans.updateOne(
            { _id: scan._id, "detections._id": detectionId },
            { $push: { "detections.$.corrections": correction } }
        );

        res.status(201).json({ ok: true, correctionId: String(correction._id) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// -------------------- achievements --------------------
app.get("/api/achievements/catalog", authRequired, async (req, res) => {
    try {
        const ach = await achievementsCol();
        const rows = await ach.find({}).sort({ code: 1 }).toArray();
        res.json({ ok: true, achievements: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/achievements/mine", authRequired, async (req, res) => {
    try {
        if (req.user.isGuest) return res.json({ ok: true, earned: [] });

        const ua = await userAchievementsCol();
        const ach = await achievementsCol();

        const earned = await ua.find({ userId: req.user.id }).sort({ earnedAt: -1 }).toArray();

        // Join in app code (simple)
        const ids = earned.map((e) => oid(e.achievementId)).filter(Boolean);
        const achDocs = await ach.find({ _id: { $in: ids } }).toArray();
        const achMap = new Map(achDocs.map((a) => [String(a._id), a]));

        const out = earned.map((e) => {
            const a = achMap.get(String(e.achievementId));
            return {
                code: a?.code,
                title: a?.title,
                description: a?.description,
                earnedAt: e.earnedAt
            };
        });

        res.json({ ok: true, earned: out });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// -------------------- start --------------------
app.listen(PORT, () => {
    console.log(`✅ API running on port ${PORT}`);
});
