// this code whas written with the help of sources and adapted by Elouan Van Cappellen
// this code was adapted by Elouan Van Cappellen and Noah Goosens for City to Ocean (Team Rocket):
// https://www.npmjs.com/package/jsonwebtoken
// https://auth0.com/learn/json-web-tokens
// https://datatracker.ietf.org/doc/html/rfc7519#page-4
// https://expressjs.com/en/guide/writing-middleware.html

// https://www.npmjs.com/package/jsonwebtoken
// https://auth0.com/learn/json-web-tokens
// https://datatracker.ietf.org/doc/html/rfc7519
// https://expressjs.com/en/guide/writing-middleware.html

// City to Ocean API (MongoDB)
// - Auth (register/login)
// - Per-user scan items (AI-assisted)
// - Milestones (10 seeded)
// - Leaderboard (rank by scan count)
// - User stats + category breakdown for pie chart

import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import Connector from "./Connector.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

process.on("uncaughtException", (err) =>
	console.error("uncaughtException:", err),
);
process.on("unhandledRejection", (err) =>
	console.error("unhandledRejection:", err),
);

const db = new Connector();
const CLEANUP_TYPES = ["KAAI", "KAYAK"];
const CLEANUP_GROUP_WINDOW_HOURS = 3;

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
			isGuest: !!user.isGuest,
		},
		JWT_SECRET,
		{ expiresIn: "7d" },
	);
}

function authRequired(req, res, next) {
	try {
		const header = req.headers.authorization || "";
		const [type, token] = header.split(" ");
		if (type !== "Bearer" || !token)
			return res.status(401).json({ ok: false, error: "Missing token" });

		const payload = jwt.verify(token, JWT_SECRET);

		req.user = {
			id: String(payload.sub),
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
			s,
		)
	);
}

function asNonEmptyString(x) {
	return typeof x === "string" && x.trim().length ? x.trim() : null;
}

async function findOrCreateGroupedCleanup({
	cleanupType,
	takenAt,
	userId,
}) {
	// update
	const cleanups = await cleanupsCol();

	const date = takenAt instanceof Date ? takenAt : new Date(takenAt);
	const ms = CLEANUP_GROUP_WINDOW_HOURS * 60 * 60 * 1000;

	const from = new Date(date.getTime() - ms);
	const to = new Date(date.getTime() + ms);

	const existing = await cleanups.findOne({
		cleanupType,
		startsAt: { $gte: from, $lte: to },
	});

	if (existing) return existing;

	// new
	const autoName = `${cleanupType} cleanup ${date.toLocaleDateString("nl-BE")} ${date
		.toTimeString()
		.slice(0, 5)}`;

	const doc = {
		eventId: null,
		name: autoName,
		cleanupType,
		startsAt: date,
		endsAt: null,
		createdBy: userId ?? null, 
		createdAt: new Date(),
		isAutoGrouped: true,
	};

	const result = await cleanups.insertOne(doc);
	return { ...doc, _id: result.insertedId };
}


// -------------------- collections --------------------
async function usersCol() {
	return db.col("users");
}
async function eventsCol() {
	return db.col("events");
}
async function cleanupsCol() {
	return db.col("cleanups");
}
async function scansCol() {
	return db.col("scans");
}
async function achievementsCol() {
	return db.col("achievements");
}
async function userAchievementsCol() {
	return db.col("user_achievements");
}
async function scanItemsCol() {
	return db.col("scan_items");
}
async function milestonesCol() {
	return db.col("milestones");
}
async function userMilestonesCol() {
	return db.col("user_milestones");
}

// -------------------- seeding + indexes --------------------
async function ensureIndexes() {
	const scanItems = await scanItemsCol();
	await scanItems.createIndex({ userId: 1, createdAt: -1 });
	await scanItems.createIndex({ userId: 1, category: 1, createdAt: -1 });

	const users = await usersCol();
	await users.createIndex({ email: 1 }, { unique: true });

	const milestones = await milestonesCol();
	await milestones.createIndex({ code: 1 }, { unique: true });

	const userMilestones = await userMilestonesCol();
	await userMilestones.createIndex(
		{ userId: 1, milestoneCode: 1 },
		{ unique: true },
	);

	const ach = await achievementsCol();
	await ach.createIndex({ code: 1 }, { unique: true });

	const ua = await userAchievementsCol();
	await ua.createIndex({ userId: 1, achievementId: 1 }, { unique: true });
}

async function ensureAchievementSeed() {
	const ach = await achievementsCol();
	await ach.updateOne(
		{ code: "FIRST_SCAN" },
		{
			$setOnInsert: {
				code: "FIRST_SCAN",
				title: "First scan",
				description: "You confirmed your first scanned item.",
				createdAt: new Date(),
			},
		},
		{ upsert: true },
	);
}

async function ensureMilestoneSeed() {
	const milestones = await milestonesCol();
	const count = await milestones.countDocuments({});
	if (count > 0) return;

	const now = new Date();
	await milestones.insertMany([
		{
			code: "SCAN_1",
			title: "First cleanup",
			description: "Scan 1 item",
			icon: "eco",
			type: "TOTAL_SCANS",
			target: 1,
			createdAt: now,
		},
		{
			code: "SCAN_3",
			title: "Getting started",
			description: "Scan 3 items",
			icon: "flag",
			type: "TOTAL_SCANS",
			target: 3,
			createdAt: now,
		},
		{
			code: "SCAN_10",
			title: "On a roll",
			description: "Scan 10 items",
			icon: "local_fire_department",
			type: "TOTAL_SCANS",
			target: 10,
			createdAt: now,
		},
		{
			code: "SCAN_25",
			title: "Cleaner streets",
			description: "Scan 25 items",
			icon: "public",
			type: "TOTAL_SCANS",
			target: 25,
			createdAt: now,
		},
		{
			code: "CAN_5",
			title: "Can collector",
			description: "Scan 5 cans",
			icon: "sports_bar",
			type: "CATEGORY_SCANS",
			category: "can",
			target: 5,
			createdAt: now,
		},
		{
			code: "CAN_10",
			title: "Can pro",
			description: "Scan 10 cans",
			icon: "workspace_premium",
			type: "CATEGORY_SCANS",
			category: "can",
			target: 10,
			createdAt: now,
		},
		{
			code: "CARDBOARD_3",
			title: "Flatten it",
			description: "Scan 3 cardboard items",
			icon: "inventory_2",
			type: "CATEGORY_SCANS",
			category: "cardboard",
			target: 3,
			createdAt: now,
		},
		{
			code: "CARDBOARD_10",
			title: "Box breaker",
			description: "Scan 10 cardboard items",
			icon: "local_shipping",
			type: "CATEGORY_SCANS",
			category: "cardboard",
			target: 10,
			createdAt: now,
		},
		{
			code: "BOTTLE_5",
			title: "Bottle hunter",
			description: "Scan 5 bottles",
			icon: "water_drop",
			type: "CATEGORY_SCANS",
			category: "bottle",
			target: 5,
			createdAt: now,
		},
		{
			code: "CATEGORIES_3",
			title: "Recycling mix",
			description: "Scan 3 different categories",
			icon: "category",
			type: "DISTINCT_CATEGORIES",
			target: 3,
			createdAt: now,
		},
	]);
}

async function getUserScanStats(userId) {
	const scanItems = await scanItemsCol();
	const total = await scanItems.countDocuments({ userId });

	const byCategory = await scanItems
		.aggregate([
			{ $match: { userId } },
			{ $group: { _id: "$category", count: { $sum: 1 } } },
			{ $project: { _id: 0, category: "$_id", count: 1 } },
			{ $sort: { count: -1 } },
		])
		.toArray();

	const distinct = byCategory.filter((x) => x.category && x.count > 0).length;

	return { total, byCategory, distinctCategories: distinct };
}

function evalMilestone(m, stats) {
	if (m.type === "TOTAL_SCANS") {
		const current = stats.total;
		return { unlocked: current >= m.target, current, target: m.target };
	}
	if (m.type === "CATEGORY_SCANS") {
		const current =
			stats.byCategory.find((c) => c.category === m.category)?.count ?? 0;
		return { unlocked: current >= m.target, current, target: m.target };
	}
	if (m.type === "DISTINCT_CATEGORIES") {
		const current = stats.distinctCategories;
		return { unlocked: current >= m.target, current, target: m.target };
	}
	return { unlocked: false, current: 0, target: m.target ?? 0 };
}

async function evaluateAndPersistMilestones(userId) {
	const milestones = await milestonesCol();
	const userMilestones = await userMilestonesCol();

	const catalog = await milestones
		.find({})
		.sort({ createdAt: 1, code: 1 })
		.toArray();
	const stats = await getUserScanStats(userId);

	const existing = await userMilestones.find({ userId }).toArray();
	const unlockedMap = new Map(existing.map((x) => [x.milestoneCode, x]));

	let newlyUnlocked = 0;
	for (const m of catalog) {
		const r = evalMilestone(m, stats);
		if (r.unlocked && !unlockedMap.has(m.code)) {
			await userMilestones.insertOne({
				userId,
				milestoneCode: m.code,
				unlockedAt: new Date(),
			});
			newlyUnlocked++;
		}
	}

	const freshUnlocks = await userMilestones.find({ userId }).toArray();
	const freshMap = new Map(freshUnlocks.map((x) => [x.milestoneCode, x]));

	const out = catalog.map((m) => {
		const r = evalMilestone(m, stats);
		const u = freshMap.get(m.code);
		return {
			code: m.code,
			title: m.title,
			description: m.description,
			icon: m.icon,
			type: m.type,
			category: m.category ?? null,
			target: r.target,
			current: r.current,
			unlocked: !!u,
			unlockedAt: u?.unlockedAt ?? null,
		};
	});

	return {
		stats,
		milestones: out,
		newlyUnlocked,
		completedCount: out.filter((m) => m.unlocked).length,
		totalCount: out.length,
	};
}

// -------------------- health --------------------
app.get("/api", (req, res) => {
	res.json({
		ok: true,
		name: "City to Ocean API",
		endpoints: [
			"GET /api/health",
			"GET /api/test-db",
			"POST /api/auth/guest",
			"POST /api/auth/register",
			"POST /api/auth/login",
			"GET /api/me",
			"GET /api/me/summary",
			"GET /api/me/categories",
			"GET /api/events",
			"POST /api/events",
			"GET /api/cleanups",
			"POST /api/cleanups",
			"POST /api/scans",
			"GET /api/scans",
			"GET /api/scans/:id",
			"POST /api/detections/:id/corrections",
			"POST /api/scans/items",
			"GET /api/scans/items",
			"GET /api/milestones/catalog",
			"GET /api/milestones/mine",
			"GET /api/leaderboard",
			"GET /api/achievements/catalog",
			"GET /api/achievements/mine",
		],
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

// Register
app.post("/api/auth/register", async (req, res) => {
	try {
		const { email, password, displayName } = req.body || {};

		if (!isEmail(email))
			return res.status(400).json({ ok: false, error: "Invalid email" });
		if (typeof password !== "string" || password.length < 6)
			return res
				.status(400)
				.json({ ok: false, error: "Password must be at least 6 characters" });
		if (typeof displayName !== "string" || displayName.trim().length < 2)
			return res
				.status(400)
				.json({ ok: false, error: "Display name too short" });

		const users = await usersCol();
		const existing = await users.findOne(
			{ email: email.toLowerCase() },
			{ projection: { _id: 1 } },
		);
		if (existing)
			return res.status(409).json({ ok: false, error: "Email already in use" });

		const passwordHash = await bcrypt.hash(password, 10);

		const doc = {
			email: email.toLowerCase(),
			passwordHash,
			displayName: displayName.trim(),
			isGuest: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		const result = await users.insertOne(doc);
		const user = { ...doc, _id: result.insertedId };
		const token = signToken(user);

		res.status(201).json({
			ok: true,
			token,
			user: {
				id: String(user._id),
				email: user.email,
				displayName: user.displayName,
				isGuest: false,
			},
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
		if (!user)
			return res.status(401).json({ ok: false, error: "Invalid credentials" });

		const ok = await bcrypt.compare(password, user.passwordHash);
		if (!ok)
			return res.status(401).json({ ok: false, error: "Invalid credentials" });

		const token = signToken(user);
		res.json({
			ok: true,
			token,
			user: {
				id: String(user._id),
				email: user.email,
				displayName: user.displayName,
				isGuest: !!user.isGuest,
			},
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
		const passwordHash = await bcrypt.hash(
			crypto.randomBytes(16).toString("hex"),
			10,
		);

		const doc = {
			email: guestEmail,
			passwordHash,
			displayName: "Guest",
			isGuest: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		const result = await users.insertOne(doc);
		const user = { ...doc, _id: result.insertedId };
		const token = signToken(user);

		res.status(201).json({
			ok: true,
			token,
			user: {
				id: String(user._id),
				email: user.email,
				displayName: user.displayName,
				isGuest: true,
			},
		});
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.get("/api/me", authRequired, async (req, res) => {
	try {
		const users = await usersCol();
		const _id = oid(req.user.id);
		if (!_id)
			return res.status(400).json({ ok: false, error: "Invalid user id" });

		const u = await users.findOne({ _id }, { projection: { passwordHash: 0 } });
		if (!u) return res.status(404).json({ ok: false, error: "User not found" });

		res.json({
			ok: true,
			user: {
				id: String(u._id),
				email: u.email,
				displayName: u.displayName,
				isGuest: !!u.isGuest,
			},
		});
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.get("/api/me/summary", authRequired, async (req, res) => {
	try {
		const stats = await getUserScanStats(req.user.id);
		const ms = await evaluateAndPersistMilestones(req.user.id);

		res.json({
			ok: true,
			user: req.user,
			summary: {
				scanCount: stats.total,
				distinctCategories: stats.distinctCategories,
				milestonesCompleted: ms.completedCount,
				milestonesTotal: ms.totalCount,
			},
		});
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.get("/api/me/categories", authRequired, async (req, res) => {
	try {
		const stats = await getUserScanStats(req.user.id);
		res.json({ ok: true, categories: stats.byCategory, total: stats.total });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// -------------------- events --------------------
app.get("/api/events", authRequired, async (req, res) => {
	try {
		const events = await eventsCol();
		const rows = await events
			.find({})
			.sort({ startsAt: -1, createdAt: -1 })
			.toArray();
		res.json({ ok: true, events: rows });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.post("/api/events", authRequired, async (req, res) => {
	try {
		const {
			title,
			description = null,
			startsAt = null,
			endsAt = null,
			locationName = null,
		} = req.body || {};
		if (typeof title !== "string" || title.trim().length < 2)
			return res.status(400).json({ ok: false, error: "Title too short" });

		const events = await eventsCol();
		const doc = {
			title: title.trim(),
			description,
			startsAt: startsAt ? new Date(startsAt) : null,
			endsAt: endsAt ? new Date(endsAt) : null,
			locationName,
			createdAt: new Date(),
		};

		const result = await events.insertOne(doc);
		res
			.status(201)
			.json({ ok: true, event: { ...doc, _id: result.insertedId } });
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

		const rows = await cleanups
			.find(filter)
			.sort({ startsAt: -1, createdAt: -1 })
			.toArray();
		res.json({ ok: true, cleanups: rows });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.post("/api/cleanups", authRequired, async (req, res) => {
	try {
		const {
			eventId = null,
			name,
			cleanupType,
			startsAt = null,
			endsAt = null,
		} = req.body || {};

		if (typeof name !== "string" || name.trim().length < 2)
			return res.status(400).json({ ok: false, error: "Name too short" });

		if (!CLEANUP_TYPES.includes(cleanupType))
			return res.status(400).json({ ok: false, error: "Invalid cleanupType" });

		const cleanups = await cleanupsCol();
		const doc = {
			eventId: eventId ? String(eventId) : null,
			name: name.trim(),
			cleanupType,
			startsAt: startsAt ? new Date(startsAt) : null,
			endsAt: endsAt ? new Date(endsAt) : null,
			createdBy: req.user.id,
			createdAt: new Date(),
		};

		const result = await cleanups.insertOne(doc);
		res
			.status(201)
			.json({ ok: true, cleanup: { ...doc, _id: result.insertedId } });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// -------------------- legacy scans + detections + corrections --------------------
app.post("/api/scans", authRequired, async (req, res) => {
	try {
		const {
			cleanupId = null,
			cleanupType = null, // "KAAI" | "KAYAK"
			imageUrl,
			takenAt = null,
			lat = null,
			lng = null,
			gpsAccuracyM = null,
			notes = null,
			detections = [],
		} = req.body || {};

		if (typeof imageUrl !== "string" || imageUrl.length < 5) {
			return res.status(400).json({ ok: false, error: "imageUrl required" });
		}

		if (cleanupType && !CLEANUP_TYPES.includes(cleanupType)) {
			return res.status(400).json({ ok: false, error: "Invalid cleanupType" });
		}

		const takenAtDate = takenAt ? new Date(takenAt) : new Date();

		let finalCleanupId = cleanupId ? String(cleanupId) : null;

		if (!finalCleanupId && cleanupType) {
			const grouped = await findOrCreateGroupedCleanup({
				cleanupType,
				takenAt: takenAtDate,
				userId: req.user.id,
			});
			finalCleanupId = String(grouped._id);
		}

		const detDocs = Array.isArray(detections)
			? detections
				.filter((d) => d?.wasteTypeAi)
				.map((d) => ({
					_id: new ObjectId(),
					wasteTypeAi: d.wasteTypeAi,
					brandAi: d.brandAi ?? null,
					confAi: d.confAi ?? null,
					x1: d.x1 ?? null,
					y1: d.y1 ?? null,
					x2: d.x2 ?? null,
					y2: d.y2 ?? null,
					cropImageUrl: d.cropImageUrl ?? null,
					createdAt: new Date(),
					corrections: [],
				}))
			: [];

		const scanDoc = {
			userId: req.user.id,
			cleanupId: finalCleanupId,
			cleanupType: cleanupType ?? null,
			imageUrl,
			takenAt: takenAtDate,
			location: {
				lat,
				lng,
				gpsAccuracyM,
			},
			notes,
			detections: detDocs,
			createdAt: new Date(),
		};

		const scans = await scansCol();
		const result = await scans.insertOne(scanDoc);

		if (!req.user.isGuest) {
			const ach = await achievementsCol();
			const ua = await userAchievementsCol();

			const firstScan = await ach.findOne(
				{ code: "FIRST_SCAN" },
				{ projection: { _id: 1 } }
			);

			if (firstScan) {
				await ua.updateOne(
					{
						userId: req.user.id,
						achievementId: String(firstScan._id),
					},
					{
						$setOnInsert: {
							userId: req.user.id,
							achievementId: String(firstScan._id),
							earnedAt: new Date(),
						},
					},
					{ upsert: true }
				);
			}
		}

		res.status(201).json({
			ok: true,
			scanId: String(result.insertedId),
			cleanupId: finalCleanupId,
		});
	} catch (err) {
		console.error("POST /api/scans failed:", err);
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.get("/api/scans/items", authRequired, async (req, res) => {
	try {
		const { limit = 100, offset = 0, category = null } = req.query;
		const scanItems = await scanItemsCol();

		const filter = { userId: req.user.id };
		if (category) filter.category = String(category);

		const items = await scanItems
			.find(filter)
			.sort({ createdAt: -1 })
			.skip(Number(offset))
			.limit(Number(limit))
			.toArray();

		res.json({ ok: true, items });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.get("/api/scans/:id", authRequired, async (req, res) => {
	try {
		const scans = await scansCol();
		const _id = oid(req.params.id);
		if (!_id)
			return res.status(400).json({ ok: false, error: "Invalid scan id" });

		const scan = await scans.findOne({ _id, userId: req.user.id });
		if (!scan)
			return res.status(404).json({ ok: false, error: "Scan not found" });

		const detections = (scan.detections ?? []).map((d) => {
			const latest = (d.corrections ?? []).at(-1);
			return {
				detectionId: String(d._id),
				scanId: String(scan._id),
				wasteType: latest?.wasteTypeUser ?? d.wasteTypeAi,
				brand: latest?.brandUser ?? d.brandAi,
				confAi: d.confAi,
				x1: d.x1,
				y1: d.y1,
				x2: d.x2,
				y2: d.y2,
				cropImageUrl: d.cropImageUrl,
				correctedAt: latest?.createdAt ?? null,
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
		if (!detectionId)
			return res.status(400).json({ ok: false, error: "Invalid detection id" });

		const {
			wasteTypeUser = null,
			brandUser = null,
			comment = null,
		} = req.body || {};
		const scans = await scansCol();

		const scan = await scans.findOne(
			{ userId: req.user.id, "detections._id": detectionId },
			{ projection: { _id: 1 } },
		);
		if (!scan)
			return res.status(404).json({ ok: false, error: "Detection not found" });

		const correction = {
			_id: new ObjectId(),
			userId: req.user.id,
			wasteTypeUser,
			brandUser,
			comment,
			createdAt: new Date(),
		};

		await scans.updateOne(
			{ _id: scan._id, "detections._id": detectionId },
			{ $push: { "detections.$.corrections": correction } },
		);

		res.status(201).json({ ok: true, correctionId: String(correction._id) });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// -------------------- confirmed scan items (YES/NO flow) --------------------

app.post("/api/scans/items", authRequired, async (req, res) => {
	try {
		const objectName = asNonEmptyString(req.body?.objectName);
		const category = asNonEmptyString(req.body?.category);
		const ai = req.body?.ai ?? null;

		if (!objectName)
			return res
				.status(400)
				.json({ ok: false, error: "objectName is required" });
		if (!category)
			return res.status(400).json({ ok: false, error: "category is required" });

		const scanItems = await scanItemsCol();
		const doc = {
			userId: req.user.id,
			objectName,
			category,
			ai,
			createdAt: new Date(),
		};

		const result = await scanItems.insertOne(doc);

		const ms = await evaluateAndPersistMilestones(req.user.id);

		if (!req.user.isGuest) {
			const ach = await achievementsCol();
			const ua = await userAchievementsCol();
			const firstScan = await ach.findOne(
				{ code: "FIRST_SCAN" },
				{ projection: { _id: 1 } },
			);
			if (firstScan) {
				await ua.updateOne(
					{ userId: req.user.id, achievementId: String(firstScan._id) },
					{
						$setOnInsert: {
							userId: req.user.id,
							achievementId: String(firstScan._id),
							earnedAt: new Date(),
						},
					},
					{ upsert: true },
				);
			}
		}

		res
			.status(201)
			.json({ ok: true, itemId: String(result.insertedId), milestones: ms });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.get("/api/scans/items", authRequired, async (req, res) => {
	try {
		const { limit = 100, offset = 0, category = null } = req.query;
		const scanItems = await scanItemsCol();

		const filter = { userId: req.user.id };
		if (category) filter.category = String(category);

		const items = await scanItems
			.find(filter)
			.sort({ createdAt: -1 })
			.skip(Number(offset))
			.limit(Number(limit))
			.toArray();

		res.json({ ok: true, items });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// -------------------- milestones --------------------
app.get("/api/milestones/catalog", authRequired, async (req, res) => {
	try {
		const milestones = await milestonesCol();
		const rows = await milestones
			.find({})
			.sort({ createdAt: 1, code: 1 })
			.toArray();
		res.json({ ok: true, milestones: rows });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

app.get("/api/milestones/mine", authRequired, async (req, res) => {
	try {
		const r = await evaluateAndPersistMilestones(req.user.id);
		const percent = r.totalCount
			? Math.round((r.completedCount / r.totalCount) * 100)
			: 0;
		res.json({ ok: true, ...r, percent });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// -------------------- leaderboard --------------------
app.get("/api/leaderboard", authRequired, async (req, res) => {
	try {
		const limit = Math.min(Number(req.query.limit ?? 50), 200);
		const scanItems = await scanItemsCol();

		const rows = await scanItems
			.aggregate([
				{ $group: { _id: "$userId", scanCount: { $sum: 1 } } },
				{ $sort: { scanCount: -1, _id: 1 } },
				{ $limit: limit },
				{ $addFields: { userObjectId: { $toObjectId: "$_id" } } },
				{
					$lookup: {
						from: "users",
						localField: "userObjectId",
						foreignField: "_id",
						as: "user",
					},
				},
				{ $unwind: "$user" },
				{
					$project: {
						_id: 0,
						userId: "$_id",
						displayName: "$user.displayName",
						scanCount: 1,
					},
				},
			])
			.toArray();

		res.json({ ok: true, leaderboard: rows });
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

		const earned = await ua
			.find({ userId: req.user.id })
			.sort({ earnedAt: -1 })
			.toArray();
		const ids = earned.map((e) => oid(e.achievementId)).filter(Boolean);
		const achDocs = await ach.find({ _id: { $in: ids } }).toArray();
		const achMap = new Map(achDocs.map((a) => [String(a._id), a]));

		const out = earned.map((e) => {
			const a = achMap.get(String(e.achievementId));
			return {
				code: a?.code,
				title: a?.title,
				description: a?.description,
				earnedAt: e.earnedAt,
			};
		});

		res.json({ ok: true, earned: out });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// -------------------- start --------------------
async function start() {
	await db.db();
	await ensureIndexes();
	await ensureAchievementSeed();
	await ensureMilestoneSeed();

	app.listen(PORT, () => {
		console.log(`API running on port ${PORT}`);
	});
}

start().catch((err) => {
	console.error("Failed to start API:", err);
	process.exit(1);
});
