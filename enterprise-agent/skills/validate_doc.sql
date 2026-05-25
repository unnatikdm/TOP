SELECT
    gc.commit__message as page_title,
    gc.commit__author__date as last_updated,
    gc.html_url as doc_url,
    'README.md' as file_path,
    'true' as file_exists,
    'Documentation found' as validation_status,
    'Review recent commits' as recommendation
FROM github.commits gc
WHERE gc.owner = '{{ OWNER }}' AND gc.repo = '{{ REPO }}' AND gc.commit__message LIKE '%doc%'
ORDER BY gc.commit__author__date DESC
LIMIT 5;