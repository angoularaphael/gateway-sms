import { Router } from "express";
import multer from "multer";
import { authJwt, authDevice } from "../middleware/auth.js";
import { auth, contacts, unsubscribes, devices, campaigns, dashboard } from "../controllers/index.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const api = Router();

api.post("/auth/login", auth.login);
api.get("/auth/me", authJwt, auth.me);

api.get("/contacts", authJwt, contacts.list);
api.post("/contacts", authJwt, contacts.create);
api.delete("/contacts/:id", authJwt, contacts.remove);
api.post("/contacts/import", authJwt, upload.single("file"), contacts.importCsv);
api.get("/contacts/export", authJwt, contacts.exportCsv);
api.get("/contact-lists", authJwt, contacts.lists);
api.post("/contact-lists", authJwt, contacts.createList);
api.post("/contact-lists/:id/members", authJwt, contacts.addToList);

api.get("/unsubscribes", authJwt, unsubscribes.list);
api.post("/unsubscribe", unsubscribes.create);

api.get("/devices", authJwt, devices.list);
api.post("/devices/register", authJwt, devices.register);
api.delete("/devices/:id", authJwt, devices.remove);
api.post("/devices/:id/heartbeat", authDevice, devices.heartbeat);
api.post("/devices/:id/sms-result", authDevice, devices.smsResult);
api.post("/devices/:id/incoming-sms", authDevice, devices.incomingSms);
api.get("/devices/:id/pending-sms", authDevice, devices.pendingSms);
api.patch("/devices/sims/:simId", authJwt, devices.updateSim);

api.get("/campaigns", authJwt, campaigns.list);
api.post("/campaigns", authJwt, campaigns.create);
api.get("/campaigns/:id", authJwt, campaigns.get);
api.get("/campaigns/:id/preview", authJwt, campaigns.preview);
api.post("/campaigns/:id/start", authJwt, campaigns.start);
api.post("/campaigns/:id/pause", authJwt, campaigns.pause);
api.post("/campaigns/:id/resume", authJwt, campaigns.resume);
api.post("/campaigns/:id/cancel", authJwt, campaigns.cancel);
api.get("/campaigns/:id/stats", authJwt, campaigns.stats);

api.get("/dashboard", authJwt, dashboard.stats);

api.get("/health", (_req, res) => {
  res.json({ ok: true });
});
