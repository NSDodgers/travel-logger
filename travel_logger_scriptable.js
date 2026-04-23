const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywtKyB14cOI5U5hfEy5BB_mPudqQ54_db3l6l0dg1yftryE1TV1tGAUhtcUs6neHhqLg/exec";

async function promptMenu(title, options) {
  let alert = new Alert();
  alert.title = title;
  for (let opt of options) {
    alert.addAction(opt);
  }
  alert.addCancelAction("Cancel");
  let index = await alert.presentSheet(); 
  if (index === -1) throw new Error("Cancelled"); 
  return options[index];
}

async function flashMessage(title, text) {
  let a = new Alert();
  a.title = title;
  a.message = text;
  a.addAction("Select Time");
  await a.presentAlert();
}

async function run() {
  try {
    const milestones = [
      { label: "🚐 Dep: In Transit (To Airport)", value: "Dep_InTransit" },
      { label: "🛫 Dep: Arrived at Airport", value: "Dep_AtAirport" },
      { label: "🧳 Dep: Dropped Bags", value: "Dep_Bags" },
      { label: "🛂 Dep: Through Security", value: "Dep_Security" },
      { label: "🛬 Arr: Off the Plane", value: "Arr_OffPlane" },
      { label: "🎒 Arr: Collected Bags", value: "Arr_Bags" },
      { label: "🚕 Arr: In Transit (To Destination)", value: "Arr_InTransit" },
      { label: "🏠 Arr: At Destination", value: "Arr_AtDestination" }
    ];
    
    let labelChosen = await promptMenu("📍 What milestone?", milestones.map(m => m.label));
    let event = milestones.find(m => m.label === labelChosen).value;
    
    let party = "";
    if (event === "Dep_InTransit" || event === "Arr_OffPlane") {
      party = await promptMenu("👥 Party Size?", ["Solo", "Family"]);
    }
    
    let transitMethod = "";
    if (event === "Dep_InTransit" || event === "Arr_InTransit") {
      let rawTransit = await promptMenu("🚗 Transit Method?", ["Car", "Public Transit"]);
      transitMethod = rawTransit === "Public Transit" ? "Transit" : "Car";
    }

    let origin = "";
    let dest = "";
    let landingAirport = "";
    let schedDep = "";
    let schedLand = "";
    
    if (event === "Dep_InTransit") {
      let fAlert = new Alert();
      fAlert.title = "🛫 Departure Trip Info";
      fAlert.addTextField("Origin (e.g. Home)", "");
      fAlert.addTextField("Departure Airport (e.g. LGA)", "");
      fAlert.addTextField("Landing Airport (e.g. ORD)", "");
      fAlert.addAction("Next");
      fAlert.addCancelAction("Cancel");
      
      let fIndex = await fAlert.presentAlert();
      if (fIndex === -1) throw new Error("Cancelled");
      
      origin = fAlert.textFieldValue(0);
      dest = fAlert.textFieldValue(1);
      landingAirport = fAlert.textFieldValue(2);

      // --- Sched Departure Time Picker ---
      await flashMessage("🛫 Scheduled Departure", "Pick your scheduled takeoff time:");
      let depPicker = new DatePicker();
      let depDate = await depPicker.pickTime();
      schedDep = depDate.toLocaleTimeString('en-US', {hour: 'numeric', minute:'2-digit'});

      // --- Sched Landing Time Picker ---
      await flashMessage("🛬 Scheduled Landing", "Pick your scheduled landing time:");
      let landPicker = new DatePicker();
      let landDate = await landPicker.pickTime();
      schedLand = landDate.toLocaleTimeString('en-US', {hour: 'numeric', minute:'2-digit'});
    } 
    else if (event === "Arr_OffPlane") {
      let aAlert = new Alert();
      aAlert.title = "🛬 Arrival Trip Info";
      aAlert.addTextField("Final Destination (e.g. Hotel / Home)", "");
      aAlert.addAction("Save");
      aAlert.addCancelAction("Cancel");
      
      let aIndex = await aAlert.presentAlert();
      if (aIndex === -1) throw new Error("Cancelled");
      
      dest = aAlert.textFieldValue(0);
    }
    
    let now = new Date();
    let timeStr = now.toLocaleTimeString('en-US', {hour: 'numeric', minute:'2-digit'}); 
    
    let queryString = `?event=${event}&time=${encodeURIComponent(timeStr)}&party=${encodeURIComponent(party)}&transitMethod=${encodeURIComponent(transitMethod)}&origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}&landingAirport=${encodeURIComponent(landingAirport)}&schedDep=${encodeURIComponent(schedDep)}&schedLand=${encodeURIComponent(schedLand)}`;
    let fullUrl = SCRIPT_URL + queryString;
    
    let req = new Request(fullUrl);
    let res = await req.loadString();
    
    let successAlert = new Alert();
    successAlert.title = "Travel Logged ✈️";
    let extra = (event === "Dep_InTransit" || event === "Arr_OffPlane") ? `\n\nTrip Started!` : "";
    successAlert.message = `Successfully logged at ${timeStr}${extra}`;
    successAlert.addAction("Awesome");
    await successAlert.presentAlert();
    
  } catch (e) {
    if (e.message !== "Cancelled") {
      let errAlert = new Alert();
      errAlert.title = "Error Logging Data";
      errAlert.message = String(e);
      errAlert.addAction("OK");
      await errAlert.presentAlert();
    }
  }
}

await run();
