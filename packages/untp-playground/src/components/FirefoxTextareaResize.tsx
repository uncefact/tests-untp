/* eslint-disable @typescript-eslint/unbound-method */
'use client';

import { useEffect } from 'react';

export function FirefoxTextareaResize() {
    useEffect(() => {
        let requestAnimationId: number;

        const checkAndResize = () => {
            // Find all textareas
            const textareas = document.querySelectorAll('textarea');

            textareas.forEach((el) => {
                // Check if the element has field-sizing: content in its style attribute
                // We check the style attribute directly or via computed style if needed, 
                // but the requirement is to look for the CSS property.
                // Since 'field-sizing' might not be invalid/supported in Firefox yet (hence this polyfill),
                // we should check the inline style string or computed style if possible (though computed might discard unknown props).
                // Safest for a "polyfill" intent where the user explicitly sets it on the element is checking style attribute text
                // or just assuming if it's there.
                // However, React sets these as inline styles usually.

                const style = el.getAttribute('style') || '';
                const computedStyle = window.getComputedStyle(el);
                const hasFieldSizing =
                    style.includes('field-sizing: content') ||
                    style.includes('field-sizing:content') ||
                    computedStyle.getPropertyValue('--field-sizing').trim() === 'content';

                if (hasFieldSizing) {
                    // Resize logic: match height to scrollHeight
                    // We only increase size to avoid jitter, or distinct auto-shrink logic if needed.
                    // Standard auto-grow:
                    if (el.scrollHeight > el.clientHeight) {
                        el.style.height = `${el.scrollHeight}px`;
                    }
                }
            });

            requestAnimationId = requestAnimationFrame(checkAndResize);
        };

        // Start the loop
        requestAnimationId = requestAnimationFrame(checkAndResize);

        return () => {
            if (requestAnimationId) {
                cancelAnimationFrame(requestAnimationId);
            }
        };
    }, []);

    return null;
}
