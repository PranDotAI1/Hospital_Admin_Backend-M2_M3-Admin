import { FHIR_BUNDLES } from "../../utils/common";

export const pushDataIntoABDM = (req: any, res: any) => {
    try {
        const OP_CONSULT = FHIR_BUNDLES.find((v: any) => v.type == "OP_CONSULT");
        const plainHealthData = JSON.stringify({ /* FHIR Bundle here */ });


    } catch (error: any) {
        return res
            .status(error.response.status)
            .json({ error: error.response.data });
    }
}