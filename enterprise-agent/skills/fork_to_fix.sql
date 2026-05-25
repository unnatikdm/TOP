SELECT
    gc.sha as hash,
    gc.commit__message as message,
    gc.commit__author__name as author,
    gc.commit__author__date as timestamp,
    gc.html_url as url
FROM github.commits gc
WHERE gc.owner = '{{ OWNER }}' AND gc.repo = '{{ REPO }}'
ORDER BY gc.commit__author__date DESC
LIMIT 20;