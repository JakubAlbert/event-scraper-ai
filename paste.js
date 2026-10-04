// paste.js
document.addEventListener('keydown', function(e) {
    // shortcut Alt+X to insert data 
    if (e.altKey && e.code === 'KeyX') {
        // Recognize the supported event form without depending on a site's domain.
        const requiredFields = ['title', 'from', 'to', 'place_name', 'locationSearch'];
        if (!requiredFields.every(id => document.getElementById(id))) return;
        
        chrome.storage.local.get(['cachedEvent'], function(result) {
            if (result.cachedEvent) {
                const data = result.cachedEvent;

                function fillInput(id, value) {
                    const el = document.getElementById(id);
                    if (el && value) {
                        el.value = value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }

                try {
                    fillInput('title', data.title);
                    fillInput('from', data.dateFrom);
                    fillInput('to', data.dateTo);
                    fillInput('place_name', data.venue);
                    fillInput('street', data.street);
                    fillInput('street_no', data.number);
                    fillInput('locationSearch', data.city);
                    fillInput('event-email', data.email);
                    fillInput('event-website', data.url);

                    setTimeout(() => {
                        const cityEl = document.getElementById('locationSearch');
                        if (cityEl) {
                            cityEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
                            cityEl.focus({ preventScroll: true });
                        }
                        
                        let checkCityInterval = setInterval(() => {
                            const cityIdEl = document.getElementById('locationId');
                            
                            if (cityIdEl && cityIdEl.value !== "0" && cityIdEl.value !== "") {
                                clearInterval(checkCityInterval); 

                                const streetEl = document.getElementById('street');
                                if (streetEl) {
                                    streetEl.dispatchEvent(new Event('blur', { bubbles: true }));
                                }
                            }
                        }, 500); 

                        setTimeout(() => { clearInterval(checkCityInterval); }, 30000);
                        
                    }, 300);
                    
                } catch (error) {
                    console.error("Chyba pri vkladaní dát:", error);
                }
            } else {
                alert("Cache je prázdna. Najprv uložte podujatie v rozšírení.");
            }
        });
    }
});
