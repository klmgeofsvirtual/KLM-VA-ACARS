(function() {
    console.log("KLM Console: Booting...");

    /* 1. UI */
    if (document.getElementById('klm-widget')) document.getElementById('klm-widget').remove();
    const ui = document.createElement('div');
    ui.id = 'klm-widget';
    ui.style = 'position:fixed;top:70px;right:10px;background:rgba(10,20,35,0.95);border-left:5px solid #00A1DE;padding:15px;width:240px;z-index:10000000;font-family:sans-serif;color:white;border-radius:4px;';
    ui.innerHTML = `
        <div style="font-weight:bold;color:#00A1DE;">KLM Console</div>
        <div id="acars-status" style="font-size:11px;">Init...</div>
        <div id="acars-main">
            <input type="text" id="pilot-id" placeholder="Discord ID" style="width:100%;margin:5px 0;color:black;">
            <button id="connect-btn" style="width:100%;background:#00A1DE;color:white;border:none;cursor:pointer;padding:5px;">CONNECT</button>
        </div>
    `;
    document.body.appendChild(ui);

    async function init() {
        console.log("KLM Console: Loading Firebase...");
        const load = (url) => new Promise(r => { const s = document.createElement('script'); s.src = url; s.onload = r; document.head.appendChild(s); });
        await load('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
        await load('https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js');
        
        const config = { apiKey: "AIzaSyBNM1Xc7a64GIlOiBiwJ5hE9Ci6EK1lxuo", projectId: "klm-dispatch" };
        if (!firebase.apps.length) firebase.initializeApp(config);
        const db = firebase.firestore();
        document.getElementById('acars-status').innerText = "Database Connected.";

        document.getElementById('connect-btn').onclick = async () => {
            const id = document.getElementById('pilot-id').value.trim();
            console.log("Attempting connect for ID:", id);
            
            // SEARCHING ALL RELEVANT STATUSES
            const snap = await db.collection('bookings')
                .where('pilot.discordId', '==', id)
                .limit(1).get();

            if (snap.empty) {
                console.error("No booking found in Firebase for this ID!");
                document.getElementById('acars-status').innerText = "ID NOT FOUND";
            } else {
                console.log("Flight linked! Starting Sensors...");
                startMonitor(db, id, snap.docs[0].data(), snap.docs[0].id);
            }
        };
    }

    function startMonitor(db, pilotId, flight, docId) {
        document.getElementById('acars-main').innerHTML = `<div style="color:#22c55e;">SOP MONITOR ACTIVE</div>`;
        console.log("MONITOR LOOP STARTED");

        setInterval(() => {
            // Check if GeoFS exists in this scope
            if (!window.geofs || !geofs.animation) {
                console.log("Waiting for GeoFS variables...");
                return;
            }

            const kias = geofs.animation.values.kias;
            const alt = geofs.animation.values.altitude;
            
            // THE CONSOLE PROOF - If you don't see this, the loop isn't running
            console.log(`Live Check -> Speed: ${Math.round(kias)} | Alt: ${Math.round(alt)}`);

            if (kias > 250 && alt < 10000) {
                console.warn("BREACH DETECTED: OVERSPEED");
                db.collection('breaches').add({
                    pilotId: pilotId,
                    type: "OVERSPEED",
                    details: `${Math.round(kias)}kts @ ${Math.round(alt)}ft`,
                    flight: flight.flightNumber || "Unknown",
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }).then(() => console.log("Breach successfully uploaded to Firebase"))
                  .catch(e => console.error("Firebase upload failed:", e));
            }
        }, 3000);
    }

    init();
})();
