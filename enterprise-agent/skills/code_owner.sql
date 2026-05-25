SELECT
    fh.commit__author__name as author,
    COUNT(*) as commit_count,
    MAX(fh.commit__author__date) as last_commit
FROM github.commits fh
WHERE fh.owner = '{{ OWNER }}' AND fh.repo = '{{ REPO }}' AND CAST(fh.commit__author__date AS TIMESTAMP) > NOW() - INTERVAL '90 days'
GROUP BY fh.commit__author__name
ORDER BY commit_count DESC
LIMIT 10;