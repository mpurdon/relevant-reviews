use regex::Regex;

pub struct ParsedPrRef {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

pub fn parse_pr_ref(input: &str) -> Result<ParsedPrRef, String> {
    let input = input.trim();

    // Full URL: https://github.com/owner/repo/pull/123
    let url_re = Regex::new(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)").unwrap();
    if let Some(caps) = url_re.captures(input) {
        return Ok(ParsedPrRef {
            owner: caps[1].to_string(),
            repo: caps[2].to_string(),
            number: caps[3].parse().unwrap(),
        });
    }

    // owner/repo/pull/123 (without the https://github.com prefix)
    let short_url_re = Regex::new(r"^([^/]+)/([^/]+)/pull/(\d+)$").unwrap();
    if let Some(caps) = short_url_re.captures(input) {
        return Ok(ParsedPrRef {
            owner: caps[1].to_string(),
            repo: caps[2].to_string(),
            number: caps[3].parse().unwrap(),
        });
    }

    // owner/repo#123
    let ref_re = Regex::new(r"^([^/]+)/([^#]+)#(\d+)$").unwrap();
    if let Some(caps) = ref_re.captures(input) {
        return Ok(ParsedPrRef {
            owner: caps[1].to_string(),
            repo: caps[2].to_string(),
            number: caps[3].parse().unwrap(),
        });
    }

    Err(format!(
        "Could not parse PR reference: '{}'. Expected: GitHub URL, owner/repo/pull/N, or owner/repo#N",
        input
    ))
}
