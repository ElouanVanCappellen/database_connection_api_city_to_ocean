# city 2 ocean — Back-end API

Link to the running Render host [API link](https://database-connection-api-city-to-ocean.onrender.com/api)

This repository contains the back-end of City to Ocean, a full-stack web application focused on tracking trash cleanup activities through photo scans, AI detection, and community engagement.

The back-end provides a REST API for:

- user authentication (registered & guest users)
- creating and managing cleanup events
- uploading trash scans with location data
- storing AI detection results and user corrections
- earning achievements (non-guest users only)

The API is built with Node.js, Express, and MongoDB, and is designed to be consumed by a separate front-end application.

---

## Up and running

### Create a .env file in the root of the project (this file is not committed to Git):

```env
# MongoDB:
MONGODB_URI=your_mongodb_connection_string_here
DB_NAME=C2O

# Auth:
JWT_SECRET=your_long_random_secret_string

# Server for local hosting:
API_PORT=3001
```

### Install dependencies

```bash
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

- **MongoDB Node.js Driver**
  MongoDB Node.js Driver.
  https://www.mongodb.com/docs/drivers/node/current/

- **MongoDB Atlas – Connection & IP access**
  in `Connector.js`
  https://www.mongodb.com/docs/atlas/

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

---

## Tech stack

- Node.js
- Express
- MySQL
- MongoDB
- jsonwebtoken (JWT authentication)
- bcryptjs (password hashing)
- dotenv (environment variables)
- cors (cross-origin requests)

---

## API overview

### Health & meta

- GET /api – API info + endpoint list
- GET /api/health – Health check
- GET /api/test-db – Test MongoDB connection

### Authentication

- POST /api/auth/guest – Create a guest user
- POST /api/auth/register – Register a new user
- POST /api/auth/login – Log in an existing user

- GET /api/me – Get current user
- GET /api/me/stats – User stats (empty for guests)

### Events & cleanups

- GET /api/events – List events

- POST /api/events – Create an event

- GET /api/cleanups – List cleanups (optional eventId)

- POST /api/cleanups – Create a cleanup

### Scans & detections

- POST /api/scans – Upload a scan (image URL + location + AI results)

- GET /api/scans – List scans for current user

- GET /api/scans/:id – Get scan + detections

- POST /api/detections/:id/corrections – Correct an AI detection

### Achievements

- GET /api/achievements/catalog – Achievement list

- GET /api/achievements/mine – Earned achievements (empty for guests)
