# city 2 ocean — Back-end API

This repository contains the back-end of Trash Collector, a full-stack web application focused on detecting, logging, and correcting waste in public spaces.
The application supports both guest users and registered users, allowing anyone to contribute data while reserving statistics and achievements for authenticated users.

The back-end exposes a REST API for authentication, events, cleanup activities, scan uploads (images + location), AI detections, user corrections, and achievements.

The API is built with Node.js, Express, and MySQL, and is designed to be consumed by a separate front-end application (Vite / GitHub Pages).

## Up and running

### Create a .env file in the root of the project (this file is not committed to Git):

```env
DB_HOST=your_mysql_host
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=your_mysql_database

API_PORT=3001
JWT_SECRET=your_long_random_secret
```

### Database setup

Run the provided SQL schema to create the database tables.

### Install dependencies

```env
npm install
```
### Run the api locally

```env
node server.js
```
It will then be available at:
```env
http://localhost:3001
```

---

## sources


- **Express documentation**  
  Used in `server.js` for routing, middleware setup, and handling HTTP requests and responses.  
  https://expressjs.com/

- **MySQL2 documentation**
Used to create a pooled MySQL connection and execute prepared statements.
https://www.npmjs.com/package/mysql2

- **MySQL2 documentation**
Used to create a pooled MySQL connection and execute prepared statements.
https://www.npmjs.com/package/mysql2

- **Auth0 – JSON Web Tokens explained**
Used as reference for JWT structure, signing, and verification.
https://auth0.com/learn/json-web-tokens/

- **Auth0 – JSON Web Tokens explained**
Used as reference for JWT structure, signing, and verification.
https://auth0.com/learn/json-web-tokens/

- **RFC 7519 – JSON Web Token (JWT)**
Official specification describing JWT format and security model.
https://datatracker.ietf.org/doc/html/rfc7519

- **MDN Web Docs – HTTP status codes**
Used to return appropriate API responses (200, 201, 400, 401, 403, 404, 500).
https://developer.mozilla.org/en-US/docs/Web/HTTP/Status

## Guest-first authentication model

The API uses JWT (JSON Web Tokens) for authentication.

Every visitor can start as a guest

Guests can:

- upload scans (images + location)
- submit detection corrections

Guests cannot:
- earn achievements
- have persistent profile statistics

When a user registers or logs in, the guest session is replaced by a registered user session.

## Tech stack

- Node.js
- Express
- MySQL
- mysql2 (database driver)
- jsonwebtoken (JWT authentication)
- bcryptjs (password hashing)
- dotenv (environment variables)
- cors (cross-origin requests)

## API overview
#### Health & diagnostics

- GET /api – Mini API documentation (self-documenting endpoint)
- GET /api/health – API health check
- GET /api/test-db – Test database connection

#### Authentication

- POST /api/auth/guest – Create a guest session
- POST /api/auth/register – Register a new user
- POST /api/auth/login – Log in a user

- GET /api/me – Get current authenticated user
- GET /api/me/stats – Get user statistics (not available for guests)

#### Events

- GET /api/events – Get all events
- POST /api/events – Create a new event

#### Cleanups

- GET /api/cleanups – Get all cleanup activities
- GET /api/cleanups?eventId=ID – Get cleanups for a specific event

- POST /api/cleanups – Create a cleanup activity

#### Scans (images + location)

- POST /api/scans – Upload a scan (guests allowed)

- GET /api/scans – Get scans of current user
- GET /api/scans/:id – Get detailed scan data

#### Detections & corrections

- POST /api/detections/:id/corrections – Add a correction to an AI detection (guests allowed)

#### Achievements

- GET /api/achievements/catalog – List all achievements
- GET /api/achievements/mine – List earned achievements (registered users only)