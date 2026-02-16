(function() {
    console.log("KLM ACARS 6.6: GASA SENSORS ONLINE");

    /* ... Keep UI and init() from previous versions ... */

    function startMonitor(db, id, flight, docId) {
        let lastGrounded = true;
        let lastBreachTime = 0;

        // Monitoring Loop
        setInterval(() => {
            if (!window.geofs || !geofs.animation) return;
            const ani = geofs.animation.values;
            const grounded = ani.groundContact;
            const vs = ani.verticalSpeed; // Vertical Speed in fpm
            const alt = ani.altitude;
            const kias = ani.kias;

            // --- THE LANDING SENSOR (GASA CHECK) ---
            if (grounded && !lastGrounded) {
                console.log(`[TOUCHDOWN] V/S: ${vs} fpm`);
                
                let landingType = "NORMAL";
                let color = "#22c55e"; // Green

                if (vs < -150) {
                    landingType = "SILK";
                    color = "#38bdf8"; // Light Blue
                    if (geofs.notifications) geofs.notifications.show("BUTTER! Silk Landing Detected.", color);
                }

                // GASA Incident Check (Harder than -600 fpm)
                if (vs <= -600) {
                    landingType = "GASA_INCIDENT";
                    color = "red";
                    if (geofs.notifications) geofs.notifications.show("⚠️ GASA INCIDENT: CRITICAL HARD LANDING", "red");
                    
                    // Log specifically to an incidents collection
                    db.collection('gasa_reports').add({
                        pilotId: id,
                        flight: flight.flightNumber,
                        vs: vs,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        status: "PENDING_INVESTIGATION"
                    });
                }

                // Update the flight document with landing stats
                db.collection('bookings').doc(docId).update({
                    landingVS: vs,
                    landingRating: landingType
                });
            }
            
            // Update "Last State" for next check
            lastGrounded = grounded;

            // --- OTHER SOP CHECKS ---
            const logBreach = (type, details) => {
                if (Date.now() - lastBreachTime < 15000) return;
                lastBreachTime = Date.now();
                db.collection('breaches').add({
                    pilotId: id,
                    type: type,
                    details: details,
                    flight: flight.flightNumber,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                if (geofs.notifications) geofs.notifications.show(`SOP BREACH: ${type}`, "red");
            };

            if (!grounded && alt < 3000 && kias > 210) logBreach("OVERSPEED_LOW", `${Math.round(kias)}kts`);

        }, 100); // Increased frequency to 10Hz (0.1s) to catch landings!
    }

    init();
})();
