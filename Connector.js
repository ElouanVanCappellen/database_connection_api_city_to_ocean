// https://www.tencentcloud.com/techpedia/132936
import mysql from "mysql2/promise";

export default class Connector {
    constructor() {
        const config = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: Number(process.env.DB_PORT) || 3306,
            waitForConnections: true,
            connectionLimit: 10,
        };

        // Hard fail early if env vars are missing
        if (!config.host || !config.user || !config.database) {
            throw new Error(
                `Missing DB env vars:
         host=${config.host}
         user=${config.user}
         db=${config.database}`
            );
        }

        this.pool = mysql.createPool(config);
    }

    async query(sql, params = []) {
        const [rows] = await this.pool.execute(sql, params);
        return rows;
    }

    async close() {
        await this.pool.end();
    }
}