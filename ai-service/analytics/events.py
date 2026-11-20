"""Validate contributed node sequences against the selected building graph."""

from math import isfinite
from fastapi import HTTPException

from analytics.schemas import JourneyEventRequest
from analytics.store import Contribution, SessionRecord
from models import NavigationEdge
from navigation.accessibility import edge_is_allowed
from navigation.graph import NavigationGraph


def build_contribution(
    *,
    event: JourneyEventRequest,
    session: SessionRecord,
    graph: NavigationGraph,
    now,
) -> Contribution:
    origin = graph.get_node(event.origin_node)
    destination = graph.get_node(event.destination_node)
    if origin is None:
        raise HTTPException(status_code=404, detail="Origin node not found")
    if destination is None:
        raise HTTPException(status_code=404, detail="Destination node not found")
    if not isfinite(event.duration_seconds):
        raise HTTPException(status_code=422, detail="duration_seconds must be finite")

    edge_pairs: list[tuple[str, str]] = []
    staircase_ids: set[str] = set()
    distance_m = 0.0
    if event.completed:
        if not event.node_sequence:
            raise HTTPException(status_code=422, detail="Completed journeys require node_sequence")
        if event.node_sequence[0] != event.origin_node or event.node_sequence[-1] != event.destination_node:
            raise HTTPException(status_code=422, detail="node_sequence must begin at origin and end at destination")
        route_nodes = []
        for node_id in event.node_sequence:
            node = graph.get_node(node_id)
            if node is None:
                raise HTTPException(status_code=422, detail=f"Unknown route node: {node_id}")
            if node.building_id != session.building_id:
                raise HTTPException(status_code=422, detail="All route nodes must belong to the session building")
            route_nodes.append(node)
            if node.staircase_connection_id:
                staircase_ids.add(node.staircase_connection_id)

        for source, target in zip(route_nodes, route_nodes[1:]):
            allowed_edges = [
                neighbor.edge
                for neighbor in graph.neighbors(source.node_id)
                if neighbor.node.node_id == target.node_id
                and edge_is_allowed(
                    neighbor.edge,
                    source,
                    target,
                    event.profile,
                    event.constraints,
                )
            ]
            if not allowed_edges:
                raise HTTPException(
                    status_code=422,
                    detail=f"Observed path contains no valid {event.profile.value} connection from {source.node_id} to {target.node_id}",
                )
            selected_edge: NavigationEdge = min(allowed_edges, key=lambda item: item.distance)
            distance_m += selected_edge.distance
            edge_pairs.append(tuple(sorted((source.node_id, target.node_id))))
    elif event.node_sequence:
        raise HTTPException(status_code=422, detail="Incomplete journeys must not include a route node sequence")

    for report in event.obstacle_reports:
        if graph.get_node(report.node_id) is None:
            raise HTTPException(status_code=422, detail=f"Unknown obstacle report node: {report.node_id}")

    return Contribution(
        event_id=event.event_id,
        session_id=session.session_id,
        contributor_digest=session.contributor_digest,
        building_id=session.building_id,
        origin_node=event.origin_node,
        destination_node=event.destination_node,
        profile=event.profile,
        context=event.context,
        completed=event.completed,
        duration_seconds=event.duration_seconds,
        distance_m=distance_m,
        edge_keys=tuple(sorted(edge_pairs)),
        staircase_ids=tuple(sorted(staircase_ids)),
        obstacle_reports=tuple((report.node_id, report.report_type) for report in event.obstacle_reports),
        created_at=now,
    )
