import { IS_SUB2API_HOST } from "@/lib/sub2api-context";
if (IS_SUB2API_HOST) {
    void import("@/lib/sub2api-bootstrap").then(m => m.startHostCanvas());
} else {
    void import("./app");
}
