import { Router } from "express";
import { auth, checkToken } from "../middlewares/user.authentication";
import { requirePermission } from "../middlewares/permissions";
import { MODULES, ACTIONS } from "../utils/permissions.constants";
import {
  reportIncident,
  listIncidents,
  getIncident,
  resolveIncident,
  getIncidentsByVisit,
} from "../controllers/incidents.controller";

const router = Router();

router.post(
  "/",
  auth(),
  requirePermission(MODULES.INCIDENT_REPORTING, ACTIONS.CREATE),
  reportIncident
);

router.get(
  "/",
  auth(),
  requirePermission(MODULES.INCIDENT_REPORTING, ACTIONS.VIEW),
  listIncidents
);

router.get(
  "/visit/:visitId",
  checkToken,
  getIncidentsByVisit
);

router.get(
  "/:id",
  checkToken,
  getIncident
);

router.patch(
  "/:id/resolve",
  auth(),
  requirePermission(MODULES.INCIDENT_REPORTING, ACTIONS.EDIT),
  resolveIncident
);

export default router;
