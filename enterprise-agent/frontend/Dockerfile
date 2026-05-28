FROM nginx:alpine

# Copy Nginx reverse proxy configuration
COPY enterprise-agent/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy static landing page
COPY index.html /usr/share/nginx/html/index.html

# Copy pre-built dashboard assets into /dashboard/ for dashboard routing
COPY dashboard/ /usr/share/nginx/html/dashboard/

# Copy all assets to root /usr/share/nginx/html/ to resolve root-relative asset URLs (e.g. logos/favicons)
COPY dashboard/ /usr/share/nginx/html/
