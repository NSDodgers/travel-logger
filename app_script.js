function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const event = e.parameter.event; 
  const time = e.parameter.time;
  const dateStr = e.parameter.date || new Date().toLocaleDateString();
  const party = e.parameter.party || ""; 
  const transitMethod = e.parameter.transitMethod || ""; 
  const origin = e.parameter.origin || "";
  const dest = e.parameter.dest || "";
  const landingAirport = e.parameter.landingAirport || "";
  const schedDep = e.parameter.schedDep || "";
  const schedLand = e.parameter.schedLand || "";
  
  let sheetName = "";
  let startCol = 0;
  let isFirstStep = false;
  let isLastStep = false;

  // Map events to columns
  if (event === "Dep_InTransit") { sheetName = "Departures"; startCol = 8; isFirstStep = true; } 
  else if (event === "Dep_AtAirport") { sheetName = "Departures"; startCol = 9; } 
  else if (event === "Dep_Bags") { sheetName = "Departures"; startCol = 10; } 
  else if (event === "Dep_Security") { sheetName = "Departures"; startCol = 11; isLastStep = true; } 
  
  else if (event === "Arr_OffPlane") { sheetName = "Arrivals"; startCol = 8; isFirstStep = true; } 
  else if (event === "Arr_Bags") { sheetName = "Arrivals"; startCol = 9; } 
  else if (event === "Arr_InTransit") { sheetName = "Arrivals"; startCol = 10; } 
  else if (event === "Arr_AtDestination") { sheetName = "Arrivals"; startCol = 11; isLastStep = true; } 

  if (!sheetName) return ContentService.createTextOutput("Error: Unknown Event");

  // Helper to find the true last row
  function getTrueLastRow(sheetObj) {
    const aValues = sheetObj.getRange("A:A").getValues();
    let last = 1; 
    for (let i = aValues.length - 1; i >= 0; i--) {
      if (aValues[i][0] !== "") {
        last = i + 1;
        break;
      }
    }
    return last;
  }

  const sheet = ss.getSheetByName(sheetName);
  let trueLastRow = getTrueLastRow(sheet);
  
  let activeRow = trueLastRow;
  let status = "";
  let lastDate = "";

  if (activeRow >= 2) {
    status = sheet.getRange(activeRow, 7).getValue(); // Col G is Status
    lastDate = sheet.getRange(activeRow, 1).getDisplayValue(); 
  }

  let needNewRow = false;
  if (activeRow < 2) needNewRow = true;
  else if (status === "Complete") needNewRow = true;
  else if (event === "Dep_InTransit") needNewRow = true; // Always start new full trip here
  else if (activeRow >= 2 && lastDate !== dateStr && status !== "In Progress") needNewRow = true;

  if (needNewRow) {
     activeRow = trueLastRow + 1;
     
     if (event === "Dep_InTransit") {
        // 1. Spawn Departures Row
        sheet.getRange(activeRow, 1, 1, 7).setValues([[dateStr, origin, dest, schedDep, party, transitMethod, "In Progress"]]);
        
        // 2. Pre-fill Arrivals Row with the SchedLand Time AND Landing Airport natively
        const arrSheet = ss.getSheetByName("Arrivals");
        let arrRow = getTrueLastRow(arrSheet) + 1;
        arrSheet.getRange(arrRow, 1, 1, 7).setValues([[dateStr, landingAirport, "", schedLand, "", "", "In Progress"]]);
     } else {
        // Fallback generic row spawner
        let schedVal = event.startsWith("Arr") ? schedLand : schedDep;
        sheet.getRange(activeRow, 1, 1, 7).setValues([[dateStr, origin, dest, schedVal, party, transitMethod, "In Progress"]]);
     }
  }

  // Inject the time into the exact milestone column!
  sheet.getRange(activeRow, startCol).setValue(time);

  // If missing fields are provided midway (e.g. Origin during Arr_OffPlane), update them dynamically
  if (origin && !sheet.getRange(activeRow, 2).getValue()) {
      sheet.getRange(activeRow, 2).setValue(origin);
  }
  if (dest && !sheet.getRange(activeRow, 3).getValue()) {
      sheet.getRange(activeRow, 3).setValue(dest);
  }
  if (party && !sheet.getRange(activeRow, 5).getValue()) {
      sheet.getRange(activeRow, 5).setValue(party);
  }
  if (transitMethod && !sheet.getRange(activeRow, 6).getValue()) {
      sheet.getRange(activeRow, 6).setValue(transitMethod);
  }

  // If this is the last step, successfully mark the trip as complete
  if (isLastStep) {
    sheet.getRange(activeRow, 7).setValue("Complete");
  }

  return ContentService.createTextOutput("Success: Logged " + event + " at " + time);
}
