/* 




care_context_reference = OPD-{YYYYMMDD}-{RANDOM}  FORMAT

{
  "notification": {
    "consentRequestId": "89a544f4-3f3f-40ef-b0cc-441e97972d23",
    "status": "GRANTED",
    "consentArtefacts": [
      {
        "id": "c25f1196-a696-4a2c-b2c9-a4a8ab1df4d6"
      }
    ]
  }
}






     ---->    token generete  *- same base header  + X-HIP-ID  *- body { abhanum,abhaaddre, name, gender, yob }.  note : more than 3 reqs, user blocks for 24 hrs
    on generate token   <-----  receives data { abha, linkToken,  }. 
    -----> care context  *- base headers + X-LINK-TOKEN + X-HIP-ID  *-  body {abhaNumber, address , patient[ { referenceNumber , display , careContexts[{ referenceNumber , display}], hiType , count } ] } 
    on care context  <----- 

   *- generate one link token and save it in db, and use it for care context , check token before consent request in case no token generate new token and save it in db and use it for care context  (no frequent token generations as in existing flow)










*/
