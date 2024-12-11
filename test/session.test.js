const axios = require("axios");
async function test() {
  const jwt = {
    dea: "IkhTMjU2Ig.eyJleHAiOjE3NjE5OTc5NTEwMDAsImRhdGEiOnsiX2lkIjoiZGVhLmVkcmlhQGdtYWlsLmNvbSIsImxpY2Vuc2UiOiJkZWEuZWRyaWFAZ21haWwuY29tIn19.ux24OW8/OqurPmZY9lzVNxt313ABgl4+k9WMcnpqnoM",
    fandi:
      "IkhTMjU2Ig.eyJleHAiOjE3NjIwNTc0NDgwMDAsImRhdGEiOnsiX2lkIjoiaXJmYW5mYW5kaTM4QGdtYWlsLmNvbSIsImxpY2Vuc2UiOiJpcmZhbmZhbmRpMzhAZ21haWwuY29tIn19.a6hqO4rDix1g7KEG0TrZtK6l0sIJm4VrsoVgYUXnpEQ",
  };

  const req = [
    request("http://localhost:6000/dea_duluan", jwt.dea),
    request("http://localhost:6000/fandi_akhir", jwt.fandi),
    request("http://localhost:6000/tanpa_auth"),
  ];

  const response = await Promise.all(req);
  console.log(response);
}

async function request(url, jwt) {
  try {
    const config = { headers: {} };
    if (jwt) config.headers["Authorization"] = jwt;
    return await axios.post(url, {}, config).then((res) => res.data);
  } catch (e) {
    return e.message;
  }
}

test();
