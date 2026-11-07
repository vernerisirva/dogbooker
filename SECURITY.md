# Security policy

Report security vulnerabilities privately through this repository's **Security → Report a vulnerability** page. Do not include account details, invitation links, database URLs or credentials in public issues. If private reporting is unavailable, request a private contact channel in an issue without describing the vulnerability.

The current main branch is supported. Installations are independently operated; maintainers cannot inspect, restore or update an operator's database.

Use a dedicated database and credentials for each environment, HTTPS for hosted installations, TLS verification for database/SMTP connections, and a strong unique auth secret. Never connect sample-data or test scripts to a live installation. See [deployment](docs/DEPLOYMENT.md) and [release review](docs/SECURITY_REVIEW.md).
