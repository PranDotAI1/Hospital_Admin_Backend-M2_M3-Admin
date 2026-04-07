import { Request, Response } from "express";
import { ConsentRequestModel } from "../../models/ConsentRequest";
import { ConsentArtefactModel } from "../../models/ConsentArtefact";
import { ConsentService } from "../../services/consent.service";

const LOG_PREFIX = "[CONSENT_CTRL]";

export const consentInitRequest = async (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (!body.abha_id) {
      return res.status(400).json({
        status: "error",
        message: "Missing required field: abha_id (patient ABHA address)",
      });
    }
    if (!body.facilityId) {
      return res.status(400).json({
        status: "error",
        message: "Missing required field: facilityId (HIU ID)",
      });
    }
    if (
      !body.hiTypes ||
      !Array.isArray(body.hiTypes) ||
      body.hiTypes.length === 0
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Missing or invalid field: hiTypes (must be a non-empty array)",
      });
    }
    if (!body.from || !body.to) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: from and to (date range)",
      });
    }
    if (!body.dataEraseAt) {
      return res.status(400).json({
        status: "error",
        message: "Missing required field: dataEraseAt",
      });
    }

    console.log(
      `${LOG_PREFIX} Consent init request for patient: ${body.abha_id}`,
    );

    const result = await ConsentService.initiateConsentRequest({
      abhaId: body.abha_id,
      hiuId: body.facilityId,
      hiTypes: body.hiTypes,
      dateFrom: body.from,
      dateTo: body.to,
      dataEraseAt: body.dataEraseAt,
      requesterName: body.requesterName,
      purposeCode: body.purposeCode,
      purposeText: body.purposeText,
      requestPurpose: body.requestPurpose,
      patientData: body.patientData,
    });

    console.log(
      `${LOG_PREFIX} Consent request initiated: requestId=${result.requestId}`,
    );

    return res.status(result.status).json({
      status: "REQUESTED",
      statusCode: result.status,
      requestId: result.requestId,
      data: result.data,
    });
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Consent init error:`,
      error.response?.data || error.message,
    );

    if (error.response) {
      return res.status(error.response.status).json({
        status: "error",
        error: error.response.data,
        details: error.message,
      });
    } else if (error.request) {
      return res.status(503).json({
        status: "error",
        error: "ABDM service unavailable",
        details: error.message,
      });
    } else {
      return res.status(500).json({
        status: "error",
        error: error.message,
      });
    }
  }
};

export const getConsentRequests = async (req: Request, res: Response) => {
  try {
    const { limit = 25, skip = 0, status, patientAbhaId } = req.query;

    const query: any = {};
    if (status) query.status = status;
    if (patientAbhaId) query.patientAbhaId = patientAbhaId;

    const requests = await ConsentRequestModel.find(query)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await ConsentRequestModel.countDocuments(query);

    return res.status(200).json({
      status: "success",
      data: requests,
      total,
      page: { limit: Number(limit), skip: Number(skip) },
    });
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error fetching consent requests:`,
      error.message,
    );
    return res.status(500).json({
      status: "error",
      error: "Failed to fetch consent requests",
      details: error.message,
    });
  }
};

export const getConsentStatus = async (req: Request, res: Response) => {
  try {
    const { consentRequestId } = req.body;

    if (!consentRequestId) {
      return res.status(400).json({
        status: "error",
        message: "Missing required field: consentRequestId",
      });
    }

    console.log(
      `${LOG_PREFIX} Checking consent status for ${consentRequestId}`,
    );

    const result = await ConsentService.checkConsentStatus(consentRequestId);

    // NOTE: Auto-trigger removed from status check. Data fetch should ONLY happen
    // via ABDM callbacks (HIP notify / on-fetch). Triggering on manual status
    // check created ghost artefacts and an infinite data fetch loop.
    // The on-notify and on-fetch callbacks already handle the GRANTED → fetch flow.

    return res.status(200).json({
      status: "success",
      message: "Consent status check initiated",
      data: result.data,
    });
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error checking consent status:`,
      error.response?.data || error.message,
    );

    if (error.response) {
      return res.status(error.response.status).json({
        status: "error",
        error: error.response.data,
      });
    }
    return res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
};

export const getConsentArtefacts = async (req: Request, res: Response) => {
  try {
    const {
      consentRequestId,
      patientAbhaAddress,
      status,
      limit = 25,
      skip = 0,
    } = req.query;

    const query: any = {};
    if (consentRequestId) query.consentRequestId = consentRequestId;
    if (patientAbhaAddress) query.patientAbhaAddress = patientAbhaAddress;
    if (status) query.status = status;

    const artefacts = await ConsentArtefactModel.find(query)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await ConsentArtefactModel.countDocuments(query);

    return res.status(200).json({
      status: "success",
      data: artefacts,
      total,
      page: { limit: Number(limit), skip: Number(skip) },
    });
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error fetching consent artefacts:`,
      error.message,
    );
    return res.status(500).json({
      status: "error",
      error: "Failed to fetch consent artefacts",
      details: error.message,
    });
  }
};

export const fetchArtefactDetails = async (req: Request, res: Response) => {
  try {
    const artefactId = req.params.artefactId as string;

    if (!artefactId) {
      return res.status(400).json({
        status: "error",
        message: "Missing artefactId parameter",
      });
    }

    console.log(`${LOG_PREFIX} Manual artefact fetch for ${artefactId}`);

    await ConsentService.fetchConsentArtefact(artefactId);

    return res.status(200).json({
      status: "success",
      message: "Artefact fetch initiated. Details will arrive via callback.",
    });
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error fetching artefact:`,
      error.response?.data || error.message,
    );
    return res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
};
