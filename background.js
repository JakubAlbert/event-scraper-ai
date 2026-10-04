importScripts('config.js', 'event-data.js', 'extractor.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Only the extension UI may start API requests.
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (request.action === 'extract_event') {
        EventExtractor.extract(request.snapshot, request.mode, request.force === true)
            .then(result => sendResponse({ ok: true, ...result }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
    if (request.action === 'enhance_event_address') {
        EventExtractor.enhanceAddress(request.event)
            .then(result => sendResponse({ ok: true, ...result }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "download-event-image",
            title: "Stiahnuť obrázok (JPEG)",
            contexts: ["all"]
        });
    });
});

const getFilename = (callback) => {
    chrome.storage.local.get(['cachedEvent'], function(result) {
        let filename = "event-image.jpeg"; 
        
        if (result.cachedEvent) {
            const data = result.cachedEvent;
            let parts = [];
            
            function slugify(text) {
                if (!text) return "";
                return text.toLowerCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "");
            }

            if (data.title) parts.push(slugify(data.title));
            if (data.city) parts.push(slugify(data.city));
            
            if (data.dateFrom) {
                let yearMatch = data.dateFrom.match(/\d{4}/);
                if (yearMatch) parts.push(yearMatch[0]);
            }
            
            if (parts.length > 0) {
                filename = parts.join("-") + ".jpeg";
            }
        }
        callback(filename);
    });
};

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "download-event-image") {
        
        chrome.tabs.sendMessage(tab.id, { action: "find_image_url", fallbackUrl: info.srcUrl }, async (response) => {
            
            if (chrome.runtime.lastError) return;

            let targetUrl = (response && response.url) ? response.url : info.srcUrl;

            if (!targetUrl || targetUrl === info.pageUrl || targetUrl.endsWith('.html')) {
                return;
            }

            if (targetUrl.startsWith('//')) {
                targetUrl = 'https:' + targetUrl;
            }

            targetUrl = targetUrl.replace(/&amp;/g, '&');

            try {
                const fetchResponse = await fetch(targetUrl, {
                    headers: { 'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }
                });
                
                if (!fetchResponse.ok) throw new Error("Fetch failed");
                
                const blob = await fetchResponse.blob();
                const imageBitmap = await createImageBitmap(blob);
                
                const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#FFFFFF"; 
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(imageBitmap, 0, 0);
                imageBitmap.close();
                
                const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
                
                const bytes = new Uint8Array(await jpegBlob.arrayBuffer());
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += 32768) {
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
                }
                getFilename((filename) => {
                    chrome.downloads.download({
                        url: 'data:image/jpeg;base64,' + btoa(binary),
                        filename: "EventImages/" + filename,
                        saveAs: true
                    });
                });

            } catch (error) {
                getFilename((filename) => {
                    chrome.downloads.download({
                        url: targetUrl,
                        filename: "EventImages/" + filename,
                        saveAs: true 
                    });
                });
            }
        });
    }
});
