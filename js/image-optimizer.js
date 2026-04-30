// ============================================================
// IMAGE-OPTIMIZER.JS — Image optimization utilities
//
// Provides lazy loading, responsive images, and optimization
// for better performance and reduced bandwidth usage.
// ============================================================

/**
 * Lazy load images when they enter the viewport
 * Uses Intersection Observer API for efficient detection
 */
export function initLazyLoading() {
    if (!('IntersectionObserver' in window)) {
        // Fallback: load all images immediately
        document.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        });
        return;
    }

    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;

                // Load the image
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                }

                // Load srcset if present
                if (img.dataset.srcset) {
                    img.srcset = img.dataset.srcset;
                    img.removeAttribute('data-srcset');
                }

                // Add loaded class for animation
                img.classList.add('loaded');

                // Stop observing this image
                observer.unobserve(img);
            }
        });
    }, {
        rootMargin: '50px 0px', // Start loading 50px before viewport
        threshold: 0.01
    });

    // Observe all images with data-src
    document.querySelectorAll('img[data-src]').forEach(img => {
        imageObserver.observe(img);
    });

    return imageObserver;
}

/**
 * Create an optimized image element with lazy loading
 * @param {Object} options Image options
 * @param {string} options.src - Image source URL
 * @param {string} [options.alt] - Alt text
 * @param {string} [options.className] - CSS class names
 * @param {string} [options.width] - Width attribute
 * @param {string} [options.height] - Height attribute
 * @param {string} [options.loading] - Loading attribute (lazy/eager)
 * @param {Object} [options.style] - Inline styles
 * @returns {HTMLImageElement}
 */
export function createOptimizedImage({
    src,
    alt = '',
    className = '',
    width,
    height,
    loading = 'lazy',
    style = {}
}) {
    const img = document.createElement('img');

    img.alt = alt;
    img.loading = loading;

    if (className) img.className = className;
    if (width) img.width = width;
    if (height) img.height = height;

    // Apply styles
    Object.assign(img.style, {
        maxWidth: '100%',
        height: 'auto',
        display: 'block',
        ...style
    });

    // Use data-src for lazy loading
    if (loading === 'lazy') {
        img.dataset.src = src;
        // Add placeholder
        img.style.backgroundColor = 'rgba(0,0,0,0.05)';
        img.style.minHeight = height || '100px';
    } else {
        img.src = src;
    }

    // Add loading animation
    img.style.transition = 'opacity 0.3s ease';
    img.style.opacity = loading === 'lazy' ? '0' : '1';

    img.addEventListener('load', () => {
        img.style.opacity = '1';
        img.classList.add('loaded');
    });

    img.addEventListener('error', () => {
        console.error(`[image-optimizer] Failed to load: ${src}`);
        img.style.opacity = '1';
        img.alt = `Failed to load: ${alt}`;
    });

    return img;
}

/**
 * Preload critical images
 * @param {string[]} urls - Array of image URLs to preload
 */
export function preloadImages(urls) {
    urls.forEach(url => {
        const img = new Image();
        img.src = url;
        // Prevent caching issues by keeping reference
        img.onload = () => console.log(`[image-optimizer] Preloaded: ${url}`);
        img.onerror = () => console.warn(`[image-optimizer] Failed to preload: ${url}`);
    });
}

/**
 * Generate responsive srcset for an image
 * @param {string} baseUrl - Base URL without extension
 * @param {string} ext - File extension (e.g., '.jpg')
 * @param {number[]} sizes - Array of widths (e.g., [320, 640, 1280])
 * @returns {string} srcset attribute value
 */
export function generateSrcset(baseUrl, ext = '.jpg', sizes = [320, 640, 1280, 1920]) {
    return sizes.map(size => `${baseUrl}-${size}w${ext} ${size}w`).join(', ');
}

/**
 * Create a responsive image with srcset
 * @param {Object} options Image options
 * @param {string} options.baseUrl - Base URL without extension
 * @param {string} [options.ext] - File extension
 * @param {string} [options.alt] - Alt text
 * @param {string} [options.sizes] - sizes attribute value
 * @param {number[]} [options.srcsetSizes] - Array of widths for srcset
 * @returns {HTMLImageElement}
 */
export function createResponsiveImage({
    baseUrl,
    ext = '.jpg',
    alt = '',
    sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw',
    srcsetSizes = [320, 640, 1280, 1920]
}) {
    const img = document.createElement('img');

    img.alt = alt;
    img.loading = 'lazy';
    img.sizes = sizes;
    img.srcset = generateSrcset(baseUrl, ext, srcsetSizes);

    // Use the largest size as fallback src
    img.src = `${baseUrl}-${Math.max(...srcsetSizes)}w${ext}`;

    // Apply base styles
    Object.assign(img.style, {
        maxWidth: '100%',
        height: 'auto',
        display: 'block'
    });

    return img;
}

/**
 * Optimize logo display with proper sizing and caching
 */
export function optimizeLogos() {
    const logos = document.querySelectorAll('.logo-image, img[alt*="logo"], img[alt*="Logo"]');

    logos.forEach(logo => {
        // Add explicit dimensions if not present
        if (!logo.width && !logo.height) {
            logo.width = 32;
            logo.height = 32;
        }

        // Add loading attribute
        if (!logo.loading) {
            logo.loading = 'eager'; // Logos are usually above the fold
        }

        // Add cache-busting query param if needed
        // const src = logo.src;
        // if (!src.includes('?') && !src.includes('data:')) {
        //     logo.src = `${src}?v=${APP_VERSION}`;
        // }
    });

    // Preload main logo
    const mainLogo = document.querySelector('.header-logo .logo-image');
    if (mainLogo && mainLogo.src) {
        preloadImages([mainLogo.src]);
    }
}

/**
 * Create an image placeholder with skeleton loading effect
 * @param {number} width - Placeholder width
 * @param {number} height - Placeholder height
 * @param {string} [backgroundColor] - Background color
 * @returns {HTMLElement}
 */
export function createSkeletonPlaceholder(width, height, backgroundColor = '#f1f5f9') {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `
        width: ${width}px;
        height: ${height}px;
        background: ${backgroundColor};
        border-radius: 8px;
        animation: skeleton-pulse 1.5s ease-in-out infinite;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Add skeleton animation keyframes if not already present
    if (!document.getElementById('skeleton-styles')) {
        const style = document.createElement('style');
        style.id = 'skeleton-styles';
        style.textContent = `
            @keyframes skeleton-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);
    }

    return placeholder;
}

/**
 * WebP feature detection and fallback
 * @param {string} webpUrl - WebP image URL
 * @param {string} fallbackUrl - Fallback image URL (JPG/PNG)
 * @returns {string} Best supported image URL
 */
export function getSupportedImage(webpUrl, fallbackUrl) {
    // Check WebP support
    const webPSupported = (() => {
        try {
            const elem = document.createElement('canvas');
            if (elem.getContext && elem.getContext('2d')) {
                return elem.toDataURL('image/webp').indexOf('data:image/webp') === 0;
            }
        } catch (e) {
            return false;
        }
        return false;
    })();

    return webPSupported ? webpUrl : fallbackUrl;
}

/**
 * Initialize all image optimizations
 * Call this once on page load
 */
export function initImageOptimizations() {
    // Initialize lazy loading
    initLazyLoading();

    // Optimize existing logos
    optimizeLogos();

    // Add responsive image support for main content images
    document.querySelectorAll('.content-container img').forEach(img => {
        if (!img.loading) {
            img.loading = 'lazy';
        }
        if (!img.style.maxWidth) {
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
        }
    });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initImageOptimizations);
} else {
    initImageOptimizations();
}