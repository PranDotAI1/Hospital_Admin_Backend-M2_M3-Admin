import { HealthInformationType } from "./hiTypeResolver";

export interface NormalizedPatientInfo {
  id?: string;
  name?: string;
  gender?: string;
  birthDate?: string;
  abhaAddress?: string;
  abhaNumber?: string;
  telecom?: string;
  address?: string;
}

export interface NormalizedPractitionerInfo {
  id?: string;
  name?: string;
  qualification?: string;
  identifier?: string;
}

export interface NormalizedOrganizationInfo {
  id?: string;
  name?: string;
  identifier?: string;
}

export interface ExtractedClinicalData {
  type: HealthInformationType | string;
  patient: NormalizedPatientInfo | null;
  practitioner?: NormalizedPractitionerInfo | null;
  organization?: NormalizedOrganizationInfo | null;
  composition?: {
    id?: string;
    title?: string;
    date?: string;
    status?: string;
  } | null;
  [key: string]: any;
}

export function extractClinicalData(
  hiType: HealthInformationType | string,
  fhirBundle: any,
): ExtractedClinicalData {
  const entries: any[] = fhirBundle?.entry || [];
  const resources: any[] = entries.map((e) => e?.resource).filter(Boolean);

  const filterResources = (type: string) =>
    resources.filter((r) => r.resourceType === type);

  const patientRes = filterResources("Patient")[0];
  const practitionerRes = filterResources("Practitioner")[0];
  const orgRes = filterResources("Organization")[0];
  const compRes = filterResources("Composition")[0];

  const patientInfo: NormalizedPatientInfo | null = patientRes
    ? {
        id: patientRes.id,
        name: extractHumanName(patientRes.name),
        gender: patientRes.gender,
        birthDate: patientRes.birthDate,
        abhaAddress: extractIdentifier(
          patientRes.identifier,
          "healthid",
          "abha",
        ),
        abhaNumber: extractIdentifier(
          patientRes.identifier,
          "ndhm",
          "abhanumber",
        ),
        telecom: patientRes.telecom?.[0]?.value,
        address: formatAddress(patientRes.address?.[0]),
      }
    : null;

  const practitionerInfo: NormalizedPractitionerInfo | null = practitionerRes
    ? {
        id: practitionerRes.id,
        name: extractHumanName(practitionerRes.name),
        qualification:
          practitionerRes.qualification?.[0]?.code?.text ||
          practitionerRes.qualification?.[0]?.code?.coding?.[0]?.display,
        identifier: practitionerRes.identifier?.[0]?.value,
      }
    : null;

  const organizationInfo: NormalizedOrganizationInfo | null = orgRes
    ? {
        id: orgRes.id,
        name: orgRes.name,
        identifier: orgRes.identifier?.[0]?.value,
      }
    : null;

  const compositionInfo = compRes
    ? {
        id: compRes.id,
        title: compRes.title,
        date: compRes.date,
        status: compRes.status,
      }
    : null;

  const baseResult: ExtractedClinicalData = {
    type: hiType,
    patient: patientInfo,
    practitioner: practitionerInfo,
    organization: organizationInfo,
    composition: compositionInfo,
  };

  switch (hiType) {
    case HealthInformationType.PRESCRIPTION:
    case "Prescription": {
      const medicationRequests = filterResources("MedicationRequest");
      return {
        ...baseResult,
        prescriptions: medicationRequests.map((med) => ({
          medicineName:
            med.medicationCodeableConcept?.text ||
            med.medicationCodeableConcept?.coding?.[0]?.display ||
            med.medicationReference?.display ||
            "Unknown Medicine",
          status: med.status,
          authoredOn: med.authoredOn,
          dosage:
            med.dosageInstruction?.[0]?.text ||
            formatDosage(med.dosageInstruction?.[0]),
          frequency:
            med.dosageInstruction?.[0]?.timing?.code?.text ||
            med.dosageInstruction?.[0]?.timing?.code?.coding?.[0]?.display,
          route:
            med.dosageInstruction?.[0]?.route?.text ||
            med.dosageInstruction?.[0]?.route?.coding?.[0]?.display,
          duration: med.dispenseRequest?.expectedSupplyDuration
            ? `${med.dispenseRequest.expectedSupplyDuration.value} ${med.dispenseRequest.expectedSupplyDuration.unit || "days"}`
            : undefined,
          instructions: med.dosageInstruction?.[0]?.patientInstruction,
        })),
      };
    }

    case HealthInformationType.OP_CONSULTATION:
    case "OPConsultation": {
      const encounter = filterResources("Encounter")[0];
      const conditions = filterResources("Condition");
      const observations = filterResources("Observation");
      const allergies = filterResources("AllergyIntolerance");
      const medicationRequests = filterResources("MedicationRequest");
      const docRefs = filterResources("DocumentReference");

      return {
        ...baseResult,
        encounter: encounter
          ? {
              status: encounter.status,
              period: encounter.period,
              reason:
                encounter.reasonCode?.[0]?.text ||
                encounter.reasonCode?.[0]?.coding?.[0]?.display,
            }
          : undefined,
        chiefComplaints: conditions
          .filter((c) => /complaint|symptom/i.test(c.category?.[0]?.coding?.[0]?.code || ""))
          .map((c) => c.code?.text || c.code?.coding?.[0]?.display)
          .filter(Boolean),
        diagnoses: conditions.map((c) => ({
          diagnosis: c.code?.text || c.code?.coding?.[0]?.display || "Undetermined Diagnosis",
          code: c.code?.coding?.[0]?.code,
          system: c.code?.coding?.[0]?.system,
          clinicalStatus: c.clinicalStatus?.coding?.[0]?.code,
          verificationStatus: c.verificationStatus?.coding?.[0]?.code,
          recordedDate: c.recordedDate,
        })),
        vitals: observations.map((o) => ({
          name: o.code?.text || o.code?.coding?.[0]?.display || "Observation",
          code: o.code?.coding?.[0]?.code,
          value: formatObservationValue(o),
          unit: o.valueQuantity?.unit,
          effectiveDateTime: o.effectiveDateTime,
        })),
        allergies: allergies.map((a) => ({
          substance: a.code?.text || a.code?.coding?.[0]?.display || "Allergen",
          criticality: a.criticality,
          manifestation:
            a.reaction?.[0]?.manifestation?.[0]?.text ||
            a.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display,
        })),
        medications: medicationRequests.map((m) => ({
          medicineName:
            m.medicationCodeableConcept?.text ||
            m.medicationCodeableConcept?.coding?.[0]?.display ||
            m.medicationReference?.display ||
            "Prescription",
          dosage:
            m.dosageInstruction?.[0]?.text ||
            formatDosage(m.dosageInstruction?.[0]),
          frequency:
            m.dosageInstruction?.[0]?.timing?.code?.text ||
            m.dosageInstruction?.[0]?.timing?.code?.coding?.[0]?.display,
          duration: m.dispenseRequest?.expectedSupplyDuration
            ? `${m.dispenseRequest.expectedSupplyDuration.value} ${m.dispenseRequest.expectedSupplyDuration.unit || "days"}`
            : undefined,
          instructions: m.dosageInstruction?.[0]?.patientInstruction,
        })),
        clinicalNotes: docRefs.map((doc) => ({
          title: doc.description || doc.type?.text,
          contentType: doc.content?.[0]?.attachment?.contentType,
          data: doc.content?.[0]?.attachment?.data,
          url: doc.content?.[0]?.attachment?.url,
        })),
      };
    }

    case HealthInformationType.DISCHARGE_SUMMARY:
    case "DischargeSummary": {
      const encounter = filterResources("Encounter")[0];
      const conditions = filterResources("Condition");
      const procedures = filterResources("Procedure");
      const carePlans = filterResources("CarePlan");
      const medications = filterResources("MedicationRequest").concat(
        filterResources("MedicationStatement"),
      );

      return {
        ...baseResult,
        admissionPeriod: encounter?.period,
        hospitalizationClass: encounter?.class?.code || encounter?.class?.display,
        diagnoses: conditions.map((c) => ({
          diagnosis: c.code?.text || c.code?.coding?.[0]?.display || "Diagnosis",
          clinicalStatus: c.clinicalStatus?.coding?.[0]?.code,
          category: c.category?.[0]?.coding?.[0]?.code || c.category?.[0]?.text,
        })),
        procedures: procedures.map((p) => ({
          name: p.code?.text || p.code?.coding?.[0]?.display,
          performedDateTime: p.performedDateTime || p.performedPeriod?.start,
          status: p.status,
          outcome: p.outcome?.text || p.outcome?.coding?.[0]?.display,
        })),
        dischargeMedications: medications.map((m) => ({
          medicineName:
            m.medicationCodeableConcept?.text ||
            m.medicationCodeableConcept?.coding?.[0]?.display ||
            m.medicationReference?.display,
          dosage:
            m.dosageInstruction?.[0]?.text ||
            formatDosage(m.dosageInstruction?.[0]),
          instructions: m.dosageInstruction?.[0]?.patientInstruction,
        })),
        carePlan: carePlans.map((cp) => ({
          title: cp.title || cp.category?.[0]?.text,
          description: cp.description,
          activity: cp.activity?.map(
            (a: any) =>
              a.detail?.description ||
              a.detail?.code?.text ||
              a.detail?.code?.coding?.[0]?.display,
          ),
        })),
      };
    }

    case HealthInformationType.DIAGNOSTIC_REPORT:
    case "DiagnosticReport": {
      const reports = filterResources("DiagnosticReport");
      const observations = filterResources("Observation");
      const specimens = filterResources("Specimen");

      return {
        ...baseResult,
        reports: reports.map((r) => ({
          testName: r.code?.text || r.code?.coding?.[0]?.display || "Diagnostic Study",
          category: r.category?.[0]?.coding?.[0]?.display || r.category?.[0]?.text,
          status: r.status,
          issued: r.issued || r.effectiveDateTime,
          conclusion: r.conclusion,
          specimen: specimens.map((s) => ({
            type: s.type?.text || s.type?.coding?.[0]?.display,
            collectionDate: s.collection?.collectedDateTime,
          })),
          results: observations.map((obs) => ({
            param: obs.code?.text || obs.code?.coding?.[0]?.display || "Parameter",
            value: formatObservationValue(obs),
            unit: obs.valueQuantity?.unit,
            referenceRange: obs.referenceRange?.[0]?.text || (
              obs.referenceRange?.[0]?.low && obs.referenceRange?.[0]?.high
                ? `${obs.referenceRange[0].low.value} - ${obs.referenceRange[0].high.value} ${obs.referenceRange[0].low.unit || ""}`
                : undefined
            ),
            interpretation: obs.interpretation?.[0]?.text || obs.interpretation?.[0]?.coding?.[0]?.display,
          })),
          attachments: r.presentedForm?.map((f: any) => ({
            title: f.title,
            contentType: f.contentType,
            data: f.data,
            url: f.url,
          })),
        })),
      };
    }

    case HealthInformationType.RECORD_ARTIFACT:
    case "HealthDocumentRecord": {
      const docRefs = filterResources("DocumentReference");
      const binaries = filterResources("Binary");

      return {
        ...baseResult,
        documents: docRefs.map((doc) => ({
          title: doc.description || doc.type?.text || "Medical Document",
          contentType: doc.content?.[0]?.attachment?.contentType,
          date: doc.date,
          data: doc.content?.[0]?.attachment?.data,
          url: doc.content?.[0]?.attachment?.url,
          size: doc.content?.[0]?.attachment?.size,
        })),
        binaries: binaries.map((b) => ({
          id: b.id,
          contentType: b.contentType,
          size: b.data ? Math.round((b.data.length * 3) / 4) : undefined,
        })),
      };
    }

    case HealthInformationType.WELLNESS_RECORD:
    case "WellnessRecord": {
      const observations = filterResources("Observation");
      const questionnaires = filterResources("QuestionnaireResponse");

      return {
        ...baseResult,
        vitals: observations.map((obs) => ({
          name: obs.code?.text || obs.code?.coding?.[0]?.display || "Metric",
          value: formatObservationValue(obs),
          unit: obs.valueQuantity?.unit,
          effectiveDateTime: obs.effectiveDateTime,
        })),
        questionnaireResponses: questionnaires.map((qr) => ({
          questionnaire: qr.questionnaire,
          authored: qr.authored,
          items: qr.item?.map((it: any) => ({
            linkId: it.linkId,
            text: it.text,
            answer: it.answer?.[0]?.valueString || it.answer?.[0]?.valueBoolean,
          })),
        })),
      };
    }

    case HealthInformationType.IMMUNIZATION_RECORD:
    case "ImmunizationRecord": {
      const immunizations = filterResources("Immunization");
      const recommendations = filterResources("ImmunizationRecommendation");

      return {
        ...baseResult,
        immunizations: immunizations.map((imm) => ({
          vaccineName:
            imm.vaccineCode?.text ||
            imm.vaccineCode?.coding?.[0]?.display ||
            "Vaccine",
          occurrenceDate: imm.occurrenceDateTime || imm.occurrenceString,
          status: imm.status,
          doseNumber:
            imm.protocolApplied?.[0]?.doseNumberPositiveInt ||
            imm.protocolApplied?.[0]?.doseNumberString,
          manufacturer: imm.manufacturer?.display,
          lotNumber: imm.lotNumber,
          expirationDate: imm.expirationDate,
        })),
        recommendations: recommendations.flatMap((rec) =>
          (rec.recommendation || []).map((r: any) => ({
            vaccine: r.vaccineCode?.[0]?.text || r.vaccineCode?.[0]?.coding?.[0]?.display,
            forecastStatus: r.forecastStatus?.coding?.[0]?.code,
            dateCriterion: r.dateCriterion?.map((d: any) => ({
              code: d.code?.coding?.[0]?.code,
              value: d.value,
            })),
          })),
        ),
      };
    }

    case HealthInformationType.INVOICE:
    case "Invoice": {
      const invoices = filterResources("Invoice");
      const chargeItems = filterResources("ChargeItem");

      return {
        ...baseResult,
        invoices: invoices.map((inv) => ({
          id: inv.id,
          date: inv.date,
          status: inv.status,
          totalNet: inv.totalNet?.value,
          totalGross: inv.totalGross?.value,
          currency: inv.totalNet?.currency || inv.totalGross?.currency || "INR",
          lineItems: inv.lineItem?.map((li: any) => ({
            sequence: li.sequence,
            chargeItemCodeableConcept:
              li.chargeItemCodeableConcept?.text ||
              li.chargeItemCodeableConcept?.coding?.[0]?.display,
            priceComponent: li.priceComponent?.map((pc: any) => ({
              type: pc.type,
              amount: pc.amount?.value,
            })),
          })),
        })),
        charges: chargeItems.map((ci) => ({
          code: ci.code?.text || ci.code?.coding?.[0]?.display,
          status: ci.status,
          quantity: ci.quantity?.value,
          price: ci.priceOverride?.value,
          currency: ci.priceOverride?.currency || "INR",
          occurrenceDateTime: ci.occurrenceDateTime,
        })),
      };
    }

    default:
      return {
        ...baseResult,
        resourceSummary: resources.map((r) => ({
          resourceType: r.resourceType,
          id: r.id,
        })),
      };
  }
}

function extractHumanName(names?: any[]): string {
  if (!names || names.length === 0) return "";
  const nameObj = names[0];
  if (nameObj.text) return nameObj.text.trim();
  const given = Array.isArray(nameObj.given) ? nameObj.given.join(" ") : "";
  const family = nameObj.family || "";
  return `${given} ${family}`.trim();
}

function extractIdentifier(identifiers?: any[], ...hints: string[]): string | undefined {
  if (!identifiers || !Array.isArray(identifiers)) return undefined;
  for (const ident of identifiers) {
    const typeText = `${ident.type?.coding?.[0]?.code || ""} ${ident.system || ""}`.toLowerCase();
    for (const hint of hints) {
      if (typeText.includes(hint.toLowerCase())) {
        return ident.value;
      }
    }
  }
  return identifiers[0]?.value;
}

function formatAddress(addr?: any): string | undefined {
  if (!addr) return undefined;
  if (addr.text) return addr.text;
  const parts = [
    ...(addr.line || []),
    addr.city,
    addr.district,
    addr.state,
    addr.postalCode,
  ].filter(Boolean);
  return parts.join(", ");
}

function formatDosage(instruction?: any): string | undefined {
  if (!instruction) return undefined;
  const dose = instruction.doseAndRate?.[0]?.doseQuantity;
  if (dose) {
    return `${dose.value} ${dose.unit || ""}`.trim();
  }
  return undefined;
}

function formatObservationValue(obs: any): string | undefined {
  if (obs.valueQuantity) {
    return `${obs.valueQuantity.value} ${obs.valueQuantity.unit || ""}`.trim();
  }
  if (obs.valueString) return obs.valueString;
  if (obs.valueCodeableConcept) {
    return (
      obs.valueCodeableConcept.text ||
      obs.valueCodeableConcept.coding?.[0]?.display
    );
  }
  if (obs.valueBoolean !== undefined) return String(obs.valueBoolean);
  if (obs.valueInteger !== undefined) return String(obs.valueInteger);
  return undefined;
}
