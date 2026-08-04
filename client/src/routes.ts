import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("./pages/SelectBase/SelectBase.tsx"),
  route("add", "./pages/AddBase/AddBase.tsx"),
  route(":base", "./pages/InsideBase/InsideBase.tsx", [
    index("./pages/OnBase/OnBase.tsx"),
    route("reconnect", "./pages/ReconnectBase/ReconnectBase.tsx"),
    route("invite", "./pages/InviteBase/InviteBase.tsx"),
    route(":node", "./pages/OnNode/OnNode.tsx"),
  ]),
] satisfies RouteConfig;
