// this code whas written with the help of sources and adapted by Elouan Van Cappellen
// this code was adapted by Elouan Van Cappellen
// MongoDB Node.js Driver docs: https://www.mongodb.com/docs/drivers/node/current/

import { MongoClient } from "mongodb";

export default class Connector {
    constructor() {
        const uri = process.env.MONGODB_URI;
        const dbName = process.env.DB_NAME;

        if (!uri || !dbName) {
            throw new Error(
                `Missing Mongo env vars:
                MONGODB_URI=${uri ? "set" : "missing"}
                DB_NAME=${dbName || "missing"}`
            );
        }

        this.client = new MongoClient(uri);
        this.dbName = dbName;

        this._db = null;
    }

    async db() {
        if (this._db) return this._db;
        await this.client.connect();
        this._db = this.client.db(this.dbName);
        return this._db;
    }

    async col(name) {
        const db = await this.db();
        return db.collection(name);
    }

    async close() {
        await this.client.close();
        this._db = null;
    }
}
