import type { APIRoute } from 'astro';

export const prerender = false;

const uniformsData = [
    {
        name: "Patrol Uniforms",
        icon: "tactical",
        items: [
            { name: "Cadet: 76861", status: "available" },
            { name: "Officer 1: 76859", status: "available" },
            { name: "Officer 2-Corporal: 76860", status: "available" },
            { name: "Supervisors: 76863", status: "available" },
            { name: "Master SGT: 76865", status: "available" }
        ]
    },
    {
        name: "Formal Attire",
        icon: "tactical",
        items: [
            { name: "Patrol Officer Formals: 76847", status: "available" },
            { name: "Command Team Formals: 76847", status: "available" }
        ]
    },
    {
        name: "Detective Attire",
        icon: "tactical",
        items: [
            { name: "Detective: 76870", status: "available" }
        ]
    },
    {
        name: "Air Unit",
        icon: "tactical",
        items: [
            { name: "Air-1: 76978", status: "available" },
            { name: "Air Tac: 76978", status: "available" }
        ]
    },
    {
        name: "MBU Unit",
        icon: "tactical",
        items: [
            { name: "MBU: 76877", status: "available" }
        ]
    }
];

export const GET: APIRoute = async () => {
    return new Response(JSON.stringify({ uniforms: uniformsData }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
};
